use std::sync::Once;

use tokio::sync::broadcast;

#[derive(Clone)]
pub enum BroadcastMessage{
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
