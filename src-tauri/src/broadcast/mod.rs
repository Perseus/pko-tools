use std::sync::Once;

use serde::Serialize;
use tokio::sync::broadcast;

#[derive(Clone, Debug, Serialize)]
pub enum BroadcastMessage {
    // order of args is
    // 1. top-level step (parsing animation, parsing mesh etc)
    // 2. inner-step (parsing header in animation, parsing helpers in mesh)
    // 3. current step number (in the inner step)
    // 4. total steps (in the inner step)
    ModelLoadingUpdate(String, String, u32, u32),
}

static mut BROADCASTER: Option<broadcast::Sender<BroadcastMessage>> = None;
static INIT: Once = Once::new();

pub fn get_broadcaster() -> broadcast::Sender<BroadcastMessage> {
    unsafe {
        INIT.call_once(|| {
            BROADCASTER = Some(broadcast::channel(100).0);
        });

        BROADCASTER.clone().unwrap()
    }
}
