import { fetchWithRetry } from './llm';

type GoogleScopes = {
  gmail?: boolean;
  drive?: boolean;
  calendar?: boolean;
};

type GoogleWorkspaceAccount = {
  id?: string;
  label?: string;
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  scopes?: GoogleScopes;
  connected?: boolean;
};

const cleanQueryText = (value: string) =>
  String(value ?? '')
    .replace(/^\[PLANNING MODE[^\]]*\]\s*/i, '')
    .replace(/\n\n\[SYSTEM NOTE:[\s\S]*$/i, '')
    .replace(/\n\n\[CHANNEL REQUEST\][\s\S]*$/i, '')
    .trim();

const escapeDriveQueryValue = (value: string) =>
  value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").slice(0, 100);

const buildDriveQuery = (query: string) => {
  const trimmed = cleanQueryText(query).replace(/\s+/g, ' ').trim();
  const terms = trimmed.split(/\s+/).filter(Boolean).slice(0, 8).join(' ');
  const value = escapeDriveQueryValue(terms || trimmed || 'agent forge');
  return `(name contains '${value}' or fullText contains '${value}') and trashed=false`;
};

export async function refreshGoogleAccessToken(clientId: string, clientSecret: string, refreshToken: string): Promise<string> {
  if (!clientId || !clientSecret || !refreshToken) throw new Error('Missing Google OAuth credentials.');
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
  if (!res.access_token) throw new Error('Google token refresh failed.');
  return res.access_token;
}

async function searchSlack(query: string, botToken: string): Promise<string> {
  const res = await fetchWithRetry(
    `https://slack.com/api/search.messages?query=${encodeURIComponent(query)}&count=5`,
    { method: 'GET', headers: { Authorization: `Bearer ${botToken}` } },
    1
  );
  if (!res.ok) throw new Error(res.error || 'Slack search failed.');
  const matches: any[] = res.messages?.matches ?? [];
  if (matches.length === 0) return 'No Slack messages found.';
  return matches
    .map(m => `[#${m.channel?.name ?? 'unknown'}] ${m.username ?? m.user ?? 'unknown'}: ${m.text ?? ''}`)
    .join('\n');
}

async function searchGmail(query: string, account: GoogleWorkspaceAccount): Promise<string> {
  const accessToken = await refreshGoogleAccessToken(account.clientId ?? '', account.clientSecret ?? '', account.refreshToken ?? '');
  const label = account.label ? ` [${account.label}]` : '';
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
    const headers: any[] = detail.payload?.headers ?? [];
    const getHeader = (name: string) => headers.find((x: any) => x.name === name)?.value ?? '';
    return `${label ? label + ' ' : ''}From: ${getHeader('From')}\nDate: ${getHeader('Date')}\nSubject: ${getHeader('Subject') || '(no subject)'}\nSnippet: ${detail.snippet ?? ''}`;
  }));
  return details.join('\n---\n');
}

async function searchDrive(query: string, account: GoogleWorkspaceAccount): Promise<string> {
  const accessToken = await refreshGoogleAccessToken(account.clientId ?? '', account.clientSecret ?? '', account.refreshToken ?? '');
  const label = account.label ? ` [${account.label}]` : '';
  const res = await fetchWithRetry(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(buildDriveQuery(query))}&fields=files(id,name,mimeType,modifiedTime,webViewLink)&pageSize=5`,
    { method: 'GET', headers: { Authorization: `Bearer ${accessToken}` } },
    1
  );
  const files: any[] = res.files ?? [];
  if (files.length === 0) return `No Google Drive files found${label}.`;
  return files.map(f => `${label ? label + ' ' : ''}${f.name} (${f.mimeType}) - modified ${f.modifiedTime}\n${f.webViewLink}`).join('\n---\n');
}

async function searchCalendar(query: string, account: GoogleWorkspaceAccount): Promise<string> {
  const accessToken = await refreshGoogleAccessToken(account.clientId ?? '', account.clientSecret ?? '', account.refreshToken ?? '');
  const label = account.label ? ` [${account.label}]` : '';
  const now = new Date().toISOString();
  const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const res = await fetchWithRetry(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?q=${encodeURIComponent(query)}&timeMin=${encodeURIComponent(now)}&timeMax=${encodeURIComponent(future)}&singleEvents=true&orderBy=startTime&maxResults=5`,
    { method: 'GET', headers: { Authorization: `Bearer ${accessToken}` } },
    1
  );
  const items: any[] = res.items ?? [];
  if (items.length === 0) return `No upcoming calendar events found matching "${query}"${label}.`;
  return items.map(e => {
    const start = e.start?.dateTime ?? e.start?.date ?? '';
    return `${label ? label + ' ' : ''}${e.summary ?? '(no title)'} - ${start}${e.location ? ` @ ${e.location}` : ''}`;
  }).join('\n');
}

async function queryGus(query: string, instanceUrl: string, accessToken: string): Promise<string> {
  const workItemMatch = query.match(/\bW-\d+\b/i);
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

export async function runIntegrationTools(agent: any, userMessage: string, integrations: any): Promise<string> {
  const tools = agent?.tools ?? {};
  const query = cleanQueryText(userMessage);
  const msg = query.toLowerCase();
  const parts: string[] = [];

  if (tools.slack && integrations?.slack?.enabled && integrations.slack?.botToken && /slack|channel|dm|direct message/.test(msg)) {
    try {
      parts.push(`[SLACK SEARCH RESULTS]\n${await searchSlack(query, integrations.slack.botToken)}`);
    } catch (e: any) {
      parts.push(`[SLACK ERROR]\n${e.message}`);
    }
  }

  const workspaces: GoogleWorkspaceAccount[] = integrations?.googleWorkspaces ?? [];
  const connectedWorkspaces = workspaces.filter((account: GoogleWorkspaceAccount) =>
    account.connected !== false && account.clientId && account.clientSecret && account.refreshToken
  );
  const toolAccounts: Record<string, string[]> = agent?.toolAccounts ?? {};
  const allowedFor = (toolId: string) => {
    const ids = toolAccounts[toolId] ?? [];
    return ids.length === 0
      ? connectedWorkspaces
      : connectedWorkspaces.filter((account: GoogleWorkspaceAccount) => account.id && ids.includes(account.id));
  };

  for (const account of allowedFor('gmail')) {
    if (tools.gmail && account.scopes?.gmail && /email|gmail|inbox|mail/.test(msg)) {
      try {
        parts.push(`[GMAIL SEARCH RESULTS]\n${await searchGmail(query, account)}`);
      } catch (e: any) {
        parts.push(`[GMAIL ERROR${account.label ? ` ${account.label}` : ''}]\n${e.message}`);
      }
    }
  }

  for (const account of allowedFor('google_drive')) {
    if (tools.google_drive && account.scopes?.drive && /drive|doc|sheet|spreadsheet|file|folder/.test(msg)) {
      try {
        parts.push(`[GOOGLE DRIVE RESULTS]\n${await searchDrive(query, account)}`);
      } catch (e: any) {
        parts.push(`[GOOGLE DRIVE ERROR${account.label ? ` ${account.label}` : ''}]\n${e.message}`);
      }
    }
  }

  for (const account of allowedFor('google_calendar')) {
    if (tools.google_calendar && account.scopes?.calendar && /calendar|event|meeting|appointment|schedule|when is|remind/.test(msg)) {
      try {
        parts.push(`[GOOGLE CALENDAR RESULTS]\n${await searchCalendar(query, account)}`);
      } catch (e: any) {
        parts.push(`[GOOGLE CALENDAR ERROR${account.label ? ` ${account.label}` : ''}]\n${e.message}`);
      }
    }
  }

  if (tools.gus && integrations?.gus?.enabled && integrations.gus?.instanceUrl && integrations.gus?.accessToken && (/gus|work item|bug|story|sprint|W-\d+/i.test(msg) || /\bW-\d+\b/.test(query))) {
    try {
      parts.push(`[GUS WORK ITEMS]\n${await queryGus(query, integrations.gus.instanceUrl, integrations.gus.accessToken)}`);
    } catch (e: any) {
      parts.push(`[GUS ERROR]\n${e.message}`);
    }
  }

  return parts.join('\n\n');
}
