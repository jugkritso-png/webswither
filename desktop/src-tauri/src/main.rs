// ไม่เปิดหน้าต่าง console บน Windows (release)
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    webmix_desktop_lib::run()
}
