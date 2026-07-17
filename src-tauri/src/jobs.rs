use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum JobStatus {
    InProgress,
    Completed,
    Interrupted,
    PausedError,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Job {
    pub id: String,
    pub name: String,
    pub status: JobStatus,
    pub logs: Vec<String>,
    pub created_at: u64,
}

fn get_jobs_file_path() -> PathBuf {
    crate::knowledge_root()
        .join("workspace")
        .join(".sys")
        .join("jobs.json")
}

pub fn read_jobs() -> Vec<Job> {
    let path = get_jobs_file_path();
    if !path.exists() {
        return vec![];
    }
    match fs::read_to_string(&path) {
        Ok(contents) => serde_json::from_str(&contents).unwrap_or_else(|_| vec![]),
        Err(_) => vec![],
    }
}

pub fn write_jobs(jobs: &Vec<Job>) -> Result<(), String> {
    let path = get_jobs_file_path();
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let json = serde_json::to_string_pretty(jobs).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_active_jobs() -> Vec<Job> {
    read_jobs()
}

#[tauri::command]
pub fn start_job(name: String) -> Result<Job, String> {
    let mut jobs = read_jobs();
    let id = uuid::Uuid::new_v4().to_string();
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();

    let job = Job {
        id,
        name,
        status: JobStatus::InProgress,
        logs: vec![],
        created_at: now,
    };

    jobs.push(job.clone());
    write_jobs(&jobs)?;
    Ok(job)
}

#[tauri::command]
pub fn update_job(id: String, status: JobStatus, log: Option<String>) -> Result<Job, String> {
    let mut jobs = read_jobs();
    let mut updated_job = None;

    for job in jobs.iter_mut() {
        if job.id == id {
            job.status = status.clone();
            if let Some(l) = log.clone() {
                job.logs.push(l);
            }
            updated_job = Some(job.clone());
            break;
        }
    }

    if let Some(job) = updated_job {
        write_jobs(&jobs)?;
        Ok(job)
    } else {
        Err("Job not found".to_string())
    }
}

#[tauri::command]
pub fn cancel_job(id: String) -> Result<(), String> {
    update_job(
        id,
        JobStatus::Cancelled,
        Some("Cancelled by user".to_string()),
    )
    .map(|_| ())
}

pub fn check_interrupted_jobs() {
    let mut jobs = read_jobs();
    let mut changed = false;
    for job in jobs.iter_mut() {
        if job.status == JobStatus::InProgress {
            job.status = JobStatus::Interrupted;
            job.logs
                .push("System restarted. Job interrupted.".to_string());
            changed = true;
        }
    }
    if changed {
        let _ = write_jobs(&jobs);
    }
}
