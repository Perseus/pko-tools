use std::path::PathBuf;
use std::str::FromStr;

use tauri::ipc::Channel;

use super::character;

#[tauri::command]
pub async fn load_animation(location: String, on_event: Channel<(String, u8)>) {
    let character = character::Character::new(PathBuf::from_str(&location).unwrap());
    let (update_channel_tx, mut update_channel_rx) =
        tokio::sync::mpsc::channel::<(String, u8)>(100);

    tauri::async_runtime::spawn(async move {
        while let Some(message) = update_channel_rx.recv().await {
            on_event
                .send(message)
                .expect("failed to emit message to the frontend");
        }
    });
    println!("Loading animation from {}", location);
    character.load_animation(update_channel_tx);
}
