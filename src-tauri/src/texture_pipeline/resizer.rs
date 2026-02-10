use image::DynamicImage;

/// Compute the next power of two >= n.
pub fn next_power_of_two(n: u32) -> u32 {
    if n == 0 {
        return 1;
    }
    n.next_power_of_two()
}

/// Compute the previous power of two <= n.
pub fn prev_power_of_two(n: u32) -> u32 {
    if n == 0 {
        return 0;
    }
    let next = n.next_power_of_two();
    if next == n {
        n
    } else {
        next / 2
    }
}

/// Check if a dimension is a power of two.
pub fn is_power_of_two(n: u32) -> bool {
    n > 0 && (n & (n - 1)) == 0
}

/// Resize an image to the given dimensions using Lanczos3 filter.
pub fn resize_to(img: &DynamicImage, width: u32, height: u32) -> DynamicImage {
    img.resize_exact(width, height, image::imageops::FilterType::Lanczos3)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn next_pot_values() {
        assert_eq!(next_power_of_two(0), 1);
        assert_eq!(next_power_of_two(1), 1);
        assert_eq!(next_power_of_two(2), 2);
        assert_eq!(next_power_of_two(3), 4);
        assert_eq!(next_power_of_two(255), 256);
        assert_eq!(next_power_of_two(256), 256);
        assert_eq!(next_power_of_two(257), 512);
        assert_eq!(next_power_of_two(300), 512);
        assert_eq!(next_power_of_two(500), 512);
        assert_eq!(next_power_of_two(1024), 1024);
    }

    #[test]
    fn prev_pot_values() {
        assert_eq!(prev_power_of_two(0), 0);
        assert_eq!(prev_power_of_two(1), 1);
        assert_eq!(prev_power_of_two(2), 2);
        assert_eq!(prev_power_of_two(3), 2);
        assert_eq!(prev_power_of_two(255), 128);
        assert_eq!(prev_power_of_two(256), 256);
        assert_eq!(prev_power_of_two(300), 256);
        assert_eq!(prev_power_of_two(1024), 1024);
    }

    #[test]
    fn is_pot_check() {
        assert!(is_power_of_two(1));
        assert!(is_power_of_two(2));
        assert!(is_power_of_two(4));
        assert!(is_power_of_two(256));
        assert!(is_power_of_two(1024));
        assert!(!is_power_of_two(0));
        assert!(!is_power_of_two(3));
        assert!(!is_power_of_two(5));
        assert!(!is_power_of_two(300));
    }
}
