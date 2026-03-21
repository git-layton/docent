{\rtf1\ansi\ansicpg1252\cocoartf2820
\cocoatextscaling0\cocoaplatform0{\fonttbl\f0\fnil\fcharset0 Menlo-Regular;}
{\colortbl;\red255\green255\blue255;\red183\green111\blue247;\red23\green24\blue24;\red202\green202\blue202;
\red212\green212\blue212;\red113\green192\blue131;\red246\green124\blue48;\red109\green115\blue120;\red163\green79\blue131;
\red54\green192\blue160;}
{\*\expandedcolortbl;;\cssrgb\c77255\c54118\c97647;\cssrgb\c11765\c12157\c12549;\cssrgb\c83137\c83137\c83137;
\cssrgb\c86275\c86275\c86275;\cssrgb\c50588\c78824\c58431;\cssrgb\c98039\c56471\c24314;\cssrgb\c50196\c52549\c54510;\cssrgb\c70588\c40000\c58431;
\cssrgb\c23922\c78824\c69020;}
\margl1440\margr1440\vieww28300\viewh14440\viewkind0
\deftab720
\pard\pardeftab720\partightenfactor0

\f0\fs28 \cf2 \cb3 \expnd0\expndtw0\kerning0
import\cf4  \cf5 \{\cf4  fetch \cf5 \}\cf4  \cf2 from\cf4  \cf6 '@tauri-apps/plugin-http'\cf5 ;\cf4 \cb1 \
\
\cf2 \cb3 export\cf4  \cf2 const\cf4  fetchWithRetry \cf5 =\cf4  \cf2 async\cf4  \cf5 (\cf4 url\cf5 ,\cf4  options\cf5 ,\cf4  retries \cf5 =\cf4  \cf7 3\cf5 ,\cf4  signal\cf5 )\cf4  \cf5 =>\cf4  \cf5 \{\cf4 \cb1 \
\cb3   \cf2 let\cf4  delay \cf5 =\cf4  \cf7 1000\cf5 ;\cf4 \cb1 \
\cb3   \cb1 \
\cb3   \cf8 // Tauri's http fetch requires headers to be a flat object, not a Headers instance\cf4 \cb1 \
\cb3   \cf2 const\cf4  safeOptions \cf5 =\cf4  \cf5 \{\cf4 \cb1 \
\cb3     method\cf5 :\cf4  options\cf5 .\cf4 method \cf5 ||\cf4  \cf6 'GET'\cf5 ,\cf4 \cb1 \
\cb3     headers\cf5 :\cf4  options\cf5 .\cf4 headers \cf5 ||\cf4  \cf5 \{\},\cf4 \cb1 \
\cb3     body\cf5 :\cf4  options\cf5 .\cf4 body\cf5 ,\cf4 \cb1 \
\cb3   \cf5 \};\cf4 \cb1 \
\
\cb3   \cf2 for\cf4  \cf5 (\cf2 let\cf4  attempt \cf5 =\cf4  \cf7 0\cf5 ;\cf4  attempt \cf5 <=\cf4  retries\cf5 ;\cf4  attempt\cf5 ++)\cf4  \cf5 \{\cf4 \cb1 \
\cb3     \cf2 try\cf4  \cf5 \{\cf4 \cb1 \
\cb3       \cf8 // This calls the Rust backend to execute the fetch, completely bypassing browser CORS\cf4 \cb1 \
\cb3       \cf2 const\cf4  res \cf5 =\cf4  \cf2 await\cf4  fetch\cf5 (\cf4 url\cf5 ,\cf4  safeOptions\cf5 );\cf4 \cb1 \
\cb3       \cb1 \
\cb3       \cf2 if\cf4  \cf5 (!\cf4 res\cf5 .\cf4 ok\cf5 )\cf4  \cf5 \{\cf4 \cb1 \
\cb3         \cf2 let\cf4  errMsg \cf5 =\cf4  \cf6 `HTTP \cf5 $\{\cf4 res\cf5 .\cf4 status\cf5 \}\cf6 `\cf5 ;\cf4 \cb1 \
\cb3         \cf2 try\cf4  \cf5 \{\cf4 \cb1 \
\cb3           \cf2 const\cf4  body \cf5 =\cf4  \cf2 await\cf4  res\cf5 .\cf4 json\cf5 ();\cf4 \cb1 \
\cb3           errMsg \cf5 =\cf4  body\cf5 ?.\cf4 error\cf5 ?.\cf4 message \cf5 ??\cf4  body\cf5 ?.\cf4 message \cf5 ??\cf4  errMsg\cf5 ;\cf4 \cb1 \
\cb3         \cf5 \}\cf4  \cf2 catch\cf4  \cf5 \{\cf4  \cf8 /* non-JSON error body */\cf4  \cf5 \}\cf4 \cb1 \
\
\cb3         \cf2 if\cf4  \cf5 (\cf4 res\cf5 .\cf4 status \cf5 ===\cf4  \cf7 400\cf4  \cf5 &&\cf4  \cf9 /context|size|too large/\cf2 i\cf5 .\cf4 test\cf5 (\cf4 errMsg\cf5 ))\cf4  \cf5 \{\cf4 \cb1 \
\cb3           \cf2 throw\cf4  \cf2 new\cf4  \cf10 Error\cf5 (\cf6 'CONTEXT_LIMIT_EXCEEDED'\cf5 );\cf4 \cb1 \
\cb3         \cf5 \}\cf4 \cb1 \
\cb3         \cf2 throw\cf4  \cf2 new\cf4  \cf10 Error\cf5 (\cf4 errMsg\cf5 );\cf4 \cb1 \
\cb3       \cf5 \}\cf4 \cb1 \
\cb3       \cf2 return\cf4  \cf2 await\cf4  res\cf5 .\cf4 json\cf5 ();\cf4 \cb1 \
\cb3     \cf5 \}\cf4  \cf2 catch\cf4  \cf5 (\cf4 err\cf5 )\cf4  \cf5 \{\cf4 \cb1 \
\cb3       \cf2 if\cf4  \cf5 (\cf4 err\cf5 .\cf4 name \cf5 ===\cf4  \cf6 'AbortError'\cf4  \cf5 ||\cf4  err\cf5 .\cf4 message \cf5 ===\cf4  \cf6 'CONTEXT_LIMIT_EXCEEDED'\cf5 )\cf4  \cf2 throw\cf4  err\cf5 ;\cf4 \cb1 \
\cb3       \cf2 if\cf4  \cf5 (\cf4 attempt \cf5 ===\cf4  retries\cf5 )\cf4  \cf2 throw\cf4  err\cf5 ;\cf4 \cb1 \
\cb3       \cf2 await\cf4  \cf2 new\cf4  \cf10 Promise\cf5 (\cf4 r \cf5 =>\cf4  setTimeout\cf5 (\cf4 r\cf5 ,\cf4  delay\cf5 ));\cf4 \cb1 \
\cb3       delay \cf5 =\cf4  \cf10 Math\cf5 .\cf4 min\cf5 (\cf4 delay \cf5 *\cf4  \cf7 2\cf5 ,\cf4  \cf7 8000\cf5 );\cf4 \cb1 \
\cb3     \cf5 \}\cf4 \cb1 \
\cb3   \cf5 \}\cf4 \cb1 \
\cf5 \cb3 \};\cf4 \cb1 \
}