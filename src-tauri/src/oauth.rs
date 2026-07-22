use std::net::TcpListener;
use std::io::{Read, Write};
use url::Url;

#[tauri::command]
pub async fn start_oauth_server(port: u16) -> Result<String, String> {
    let listener = TcpListener::bind(format!("127.0.0.1:{}", port)).map_err(|e| e.to_string())?;
    
    let result = tauri::async_runtime::spawn_blocking(move || {
        for stream in listener.incoming() {
            match stream {
                Ok(mut stream) => {
                    let mut buffer = [0; 4096];
                    if stream.read(&mut buffer).is_ok() {
                        let request = String::from_utf8_lossy(&buffer);
                        let first_line = request.lines().next().unwrap_or("");
                        if first_line.starts_with("GET /") {
                            let parts: Vec<&str> = first_line.split_whitespace().collect();
                            if parts.len() > 1 {
                                let path = parts[1];
                                if let Ok(url) = Url::parse(&format!("http://localhost{}", path)) {
                                    let mut auth_code = None;
                                    for (key, value) in url.query_pairs() {
                                        if key == "code" {
                                            auth_code = Some(value.into_owned());
                                            break;
                                        }
                                    }
                                    
                                    let response = if auth_code.is_some() {
                                        "HTTP/1.1 200 OK\r\n\r\n<html><body><h1>Authentication Successful!</h1><p>You can close this window and return to Docent.</p><script>window.close();</script></body></html>"
                                    } else {
                                        "HTTP/1.1 400 Bad Request\r\n\r\n<html><body><h1>Authentication Failed.</h1><p>Missing auth code.</p></body></html>"
                                    };
                                    let _ = stream.write_all(response.as_bytes());
                                    
                                    if let Some(code) = auth_code {
                                        return Ok(code);
                                    }
                                }
                            }
                        }
                    }
                }
                Err(_) => {}
            }
        }
        Err("Listener closed".to_string())
    }).await;
    
    result.map_err(|e| e.to_string())?.map_err(|e| e.to_string())
}
