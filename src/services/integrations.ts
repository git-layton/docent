import { fetchWithRetry } from './llm';

async function refreshGoogleAccessToken(clientId: string, clientSecret: string, refreshToken: string): Promise<string> {
  const res = await fetchWithRetry('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }).toString(),
  }, 1);
  if (!res.access_token) throw new Error('Google token refresh failed');
  return res.access_token;
}

async function searchSlack(query: string, botToken: string): Promise<string> {
  const res = await fetchWithRetry(
    `https://slack.com/api/search.messages?query=${encodeURIComponent(query)}&count=5`,
    { method: 'GET', headers: { Authorization: `Bearer ${botToken}` } },
    1
  );
  if (!res.ok) throw new Error(res.error || 'Slack search failed');
  const matches: any[] = res.messages?.matches ?? [];
  if (matches.length === 0) return 'No Slack messages found.';
  return matches
    .map(m => `[#${m.channel?.name ?? 'unknown'}] ${m.username}: ${m.text}`)
    .join('\n');
}

type GoogleCreds = { clientId: string; clientSecret: string; refreshToken: string; label?: string };

async function searchGmail(query: string, creds: GoogleCreds): Promise<string> {
  const accessToken = await refreshGoogleAccessToken(creds.clientId, creds.clientSecret, creds.refreshToken);
  const label = creds.label ? ` [${creds.label}]` : '';
  const listRes = await fetchWithRetry(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=5`,
    { method: 'GET', headers: { Authorization: `Bearer ${accessToken}` } },
    1
  );
  const messages: any[] = listRes.messages ?? [];
  if (messages.length === 0) return `No Gmail messages found${label}.`;
  const details = await Promise.all(messages.slice(0, 3).map(async (msg: any) => {
    const detail = await fetchWithRetry(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
      { method: 'GET', headers: { Authorization: `Bearer ${accessToken}` } },
      1
    );
    const h: any[] = detail.payload?.headers ?? [];
    const get = (name: string) => h.find((x: any) => x.name === name)?.value ?? '';
    return `${label ? label + ' ' : ''}From: ${get('From')}\nDate: ${get('Date')}\nSubject: ${get('Subject') || '(no subject)'}\nSnippet: ${detail.snippet ?? ''}`;
  }));
  return details.join('\n---\n');
}

async function searchDrive(query: string, creds: GoogleCreds): Promise<string> {
  const accessToken = await refreshGoogleAccessToken(creds.clientId, creds.clientSecret, creds.refreshToken);
  const label = creds.label ? ` [${creds.label}]` : '';
  const res = await fetchWithRetry(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name,mimeType,modifiedTime,webViewLink)&pageSize=5`,
    { method: 'GET', headers: { Authorization: `Bearer ${accessToken}` } },
    1
  );
  const files: any[] = res.files ?? [];
  if (files.length === 0) return `No Google Drive files found${label}.`;
  return files.map(f => `${label ? label + ' ' : ''}${f.name} (${f.mimeType}) — modified ${f.modifiedTime}\n${f.webViewLink}`).join('\n---\n');
}

async function searchCalendar(query: string, creds: GoogleCreds): Promise<string> {
  const accessToken = await refreshGoogleAccessToken(creds.clientId, creds.clientSecret, creds.refreshToken);
  const label = creds.label ? ` [${creds.label}]` : '';
  const now = new Date().toISOString();
  const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const res = await fetchWithRetry(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?q=${encodeURIComponent(query)}&timeMin=${now}&timeMax=${future}&singleEvents=true&orderBy=startTime&maxResults=5`,
    { method: 'GET', headers: { Authorization: `Bearer ${accessToken}` } },
    1
  );
  const items: any[] = res.items ?? [];
  if (items.length === 0) return `No upcoming calendar events found matching "${query}"${label}.`;
  return items.map(e => {
    const start = e.start?.dateTime ?? e.start?.date ?? '';
    // Surface the event id so the agent can reference it to move or delete the event.
    return `${label ? label + ' ' : ''}${e.summary ?? '(no title)'} — ${start}${e.location ? ` @ ${e.location}` : ''} (id: ${e.id})`;
  }).join('\n');
}

async function queryGus(query: string, instanceUrl: string, accessToken: string): Promise<string> {
  const workItemMatch = query.match(/W-\d+/i);
  let soql: string;
  if (workItemMatch) {
    const id = workItemMatch[0].toUpperCase();
    soql = `SELECT Id, Name, Subject__c, Status__c, Priority__c, Assignee__c, Sprint__r.Name FROM ADM_Work__c WHERE Name = '${id}' LIMIT 1`;
  } else {
    const escaped = query.replace(/'/g, "\\'").slice(0, 100);
    soql = `SELECT Id, Name, Subject__c, Status__c, Priority__c, Assignee__c, Sprint__r.Name FROM ADM_Work__c WHERE Subject__c LIKE '%${escaped}%' ORDER BY LastModifiedDate DESC LIMIT 5`;
  }
  const url = `${instanceUrl.replace(/\/$/, '')}/services/data/v59.0/query?q=${encodeURIComponent(soql)}`;
  const res = await fetchWithRetry(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
  }, 1);
  const records: any[] = res.records ?? [];
  if (records.length === 0) return 'No GUS work items found.';
  return records.map(r =>
    `${r.Name}: ${r.Subject__c}\nStatus: ${r.Status__c} | Priority: ${r.Priority__c} | Assignee: ${r.Assignee__c ?? 'unassigned'} | Sprint: ${r.Sprint__r?.Name ?? 'none'}`
  ).join('\n---\n');
}

// Called before each LLM request. Checks which integration tools are enabled on the agent,
// pattern-matches the user message to decide which to invoke, and returns a context block
// to inject into the system prompt. Returns '' if nothing fired.
export async function runIntegrationTools(agent: any, userMessage: string, integrations: any): Promise<string> {
  const tools = agent.tools ?? {};
  const msg = userMessage.toLowerCase();
  const parts: string[] = [];

  if (tools.slack && integrations.slack?.botToken) {
    if (/slack|channel|dm|direct message/.test(msg)) {
      try {
        parts.push(`[SLACK SEARCH RESULTS]\n${await searchSlack(userMessage, integrations.slack.botToken)}`);
      } catch (e: any) {
        parts.push(`[SLACK ERROR]\n${e.message}`);
      }
    }
  }

  const workspaces: any[] = integrations.googleWorkspaces ?? [];
  const connectedWorkspaces = workspaces.filter((a: any) => a.clientId && a.clientSecret && a.refreshToken);
  const toolAccounts: Record<string, string[]> = agent.toolAccounts ?? {};

  const allowedFor = (toolId: string) => {
    const ids = toolAccounts[toolId] ?? [];
    return ids.length === 0
      ? connectedWorkspaces
      : connectedWorkspaces.filter((a: any) => ids.includes(a.id));
  };

  for (const acct of allowedFor('gmail')) {
    if (tools.gmail && acct.scopes?.gmail && /email|gmail|inbox|mail/.test(msg)) {
      try {
        parts.push(`[GMAIL SEARCH RESULTS]\n${await searchGmail(userMessage, acct)}`);
      } catch (e: any) {
        parts.push(`[GMAIL ERROR${acct.label ? ` ${acct.label}` : ''}]\n${e.message}`);
      }
    }
  }

  for (const acct of allowedFor('google_drive')) {
    if (tools.google_drive && acct.scopes?.drive && /drive|doc|sheet|spreadsheet|file|folder/.test(msg)) {
      try {
        parts.push(`[GOOGLE DRIVE RESULTS]\n${await searchDrive(userMessage, acct)}`);
      } catch (e: any) {
        parts.push(`[GOOGLE DRIVE ERROR${acct.label ? ` ${acct.label}` : ''}]\n${e.message}`);
      }
    }
  }

  for (const acct of allowedFor('google_calendar')) {
    if (tools.google_calendar && acct.scopes?.calendar && /calendar|event|meeting|appointment|schedule|when is|remind/.test(msg)) {
      try {
        parts.push(`[GOOGLE CALENDAR RESULTS]\n${await searchCalendar(userMessage, acct)}`);
      } catch (e: any) {
        parts.push(`[GOOGLE CALENDAR ERROR${acct.label ? ` ${acct.label}` : ''}]\n${e.message}`);
      }
    }
  }

  if (tools.gus && integrations.gus?.instanceUrl && integrations.gus?.accessToken) {
    if (/gus|work item|bug|story|sprint|W-\d+/i.test(msg) || /\bW-\d+\b/.test(userMessage)) {
      try {
        parts.push(`[GUS WORK ITEMS]\n${await queryGus(userMessage, integrations.gus.instanceUrl, integrations.gus.accessToken)}`);
      } catch (e: any) {
        parts.push(`[GUS ERROR]\n${e.message}`);
      }
    }
  }

  return parts.join('\n\n');
}
