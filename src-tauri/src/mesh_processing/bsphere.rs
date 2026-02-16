use cgmath::{Matrix4, SquareMatrix, Vector3};

use crate::character::helper::BoundingSphereInfo;
use crate::math::{LwMatrix44, LwSphere, LwVector3};

/// Compute a bounding sphere for a set of 3D points using Ritter's algorithm.
///
/// Returns (center, radius). The algorithm is approximate but fast:
/// 1. Find the two most distant points along any axis.
/// 2. Create an initial sphere containing those two points.
/// 3. Expand the sphere to include all remaining points.
pub fn ritter_bounding_sphere(points: &[Vector3<f32>]) -> (Vector3<f32>, f32) {
    if points.is_empty() {
        return (Vector3::new(0.0, 0.0, 0.0), 0.0);
    }

    if points.len() == 1 {
        return (points[0], 0.0);
    }

    // Step 1: Find extreme points along each axis
    let mut min_x = points[0];
    let mut max_x = points[0];
    let mut min_y = points[0];
    let mut max_y = points[0];
    let mut min_z = points[0];
    let mut max_z = points[0];

    for p in points.iter() {
        if p.x < min_x.x {
            min_x = *p;
        }
        if p.x > max_x.x {
            max_x = *p;
        }
        if p.y < min_y.y {
            min_y = *p;
        }
        if p.y > max_y.y {
            max_y = *p;
        }
        if p.z < min_z.z {
            min_z = *p;
        }
        if p.z > max_z.z {
            max_z = *p;
        }
    }

    // Step 2: Find the pair with maximum spread
    let dx = distance_sq(&min_x, &max_x);
    let dy = distance_sq(&min_y, &max_y);
    let dz = distance_sq(&min_z, &max_z);

    let (p1, p2) = if dx >= dy && dx >= dz {
        (min_x, max_x)
    } else if dy >= dx && dy >= dz {
        (min_y, max_y)
    } else {
        (min_z, max_z)
    };

    // Step 3: Create initial sphere from the two extremes
    let mut center = (p1 + p2) * 0.5;
    let mut radius = distance(&p1, &p2) * 0.5;

    // Step 4: Expand to include all points
    for p in points.iter() {
        let dist = distance(&center, p);
        if dist > radius {
            // Expand sphere to include this point
            let new_radius = (radius + dist) * 0.5;
            let k = (new_radius - radius) / dist;
            center = center + ((*p) - center) * k;
            radius = new_radius;
        }
    }

    (center, radius)
}

fn distance_sq(a: &Vector3<f32>, b: &Vector3<f32>) -> f32 {
    let d = *a - *b;
    d.x * d.x + d.y * d.y + d.z * d.z
}

fn distance(a: &Vector3<f32>, b: &Vector3<f32>) -> f32 {
    distance_sq(a, b).sqrt()
}

/// Compute bounding spheres for a mesh model.
///
/// Strategy: compute one overall bounding sphere for the whole model.
/// For skinned meshes, optionally compute per-bone bounding spheres
/// (up to `max_spheres`).
///
/// Returns a vec of `BoundingSphereInfo` ready to use in `HelperData`.
pub fn compute_bounding_spheres(
    vertices: &[LwVector3],
    max_spheres: u32,
) -> Vec<BoundingSphereInfo> {
    if vertices.is_empty() {
        return vec![];
    }

    let points: Vec<Vector3<f32>> = vertices.iter().map(|v| v.0).collect();
    let (center, radius) = ritter_bounding_sphere(&points);

    // For external models without existing bounding spheres,
    // create a single overall bounding sphere with id=0.
    let mut spheres = vec![BoundingSphereInfo {
        id: 0,
        sphere: LwSphere {
            c: LwVector3(center),
            r: radius,
        },
        mat: LwMatrix44::from_translation_scale(center, radius),
    }];

    // If we can have more spheres, try to subdivide.
    // Split the model into segments along the longest axis
    // and create a bounding sphere for each segment.
    if max_spheres > 1 && points.len() > 10 {
        let extra = compute_axis_subdivided_spheres(&points, (max_spheres - 1).min(7) as usize);
        for (i, (c, r)) in extra.into_iter().enumerate() {
            spheres.push(BoundingSphereInfo {
                id: (i + 1) as u32,
                sphere: LwSphere { c: LwVector3(c), r },
                mat: LwMatrix44::from_translation_scale(c, r),
            });
        }
    }

    // Cap at max_spheres
    spheres.truncate(max_spheres as usize);
    spheres
}

/// Subdivide points along the longest axis and compute bounding spheres for each segment.
fn compute_axis_subdivided_spheres(
    points: &[Vector3<f32>],
    num_segments: usize,
) -> Vec<(Vector3<f32>, f32)> {
    if num_segments == 0 || points.is_empty() {
        return vec![];
    }

    // Find the longest axis
    let mut min = points[0];
    let mut max = points[0];
    for p in points.iter() {
        if p.x < min.x {
            min.x = p.x;
        }
        if p.y < min.y {
            min.y = p.y;
        }
        if p.z < min.z {
            min.z = p.z;
        }
        if p.x > max.x {
            max.x = p.x;
        }
        if p.y > max.y {
            max.y = p.y;
        }
        if p.z > max.z {
            max.z = p.z;
        }
    }

    let extents = max - min;
    let axis = if extents.x >= extents.y && extents.x >= extents.z {
        0
    } else if extents.y >= extents.x && extents.y >= extents.z {
        1
    } else {
        2
    };

    let axis_min = match axis {
        0 => min.x,
        1 => min.y,
        _ => min.z,
    };
    let axis_max = match axis {
        0 => max.x,
        1 => max.y,
        _ => max.z,
    };
    let axis_range = axis_max - axis_min;

    if axis_range < f32::EPSILON {
        return vec![];
    }

    let segment_size = axis_range / num_segments as f32;

    let mut result = vec![];

    for seg in 0..num_segments {
        let seg_min = axis_min + seg as f32 * segment_size;
        let seg_max = seg_min + segment_size;

        let segment_points: Vec<Vector3<f32>> = points
            .iter()
            .filter(|p| {
                let v = match axis {
                    0 => p.x,
                    1 => p.y,
                    _ => p.z,
                };
                v >= seg_min && v < seg_max
            })
            .copied()
            .collect();

        if segment_points.len() >= 3 {
            let (c, r) = ritter_bounding_sphere(&segment_points);
            result.push((c, r));
        }
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn single_point_sphere() {
        let points = vec![Vector3::new(1.0, 2.0, 3.0)];
        let (center, radius) = ritter_bounding_sphere(&points);
        assert!((center.x - 1.0).abs() < 0.001);
        assert!((center.y - 2.0).abs() < 0.001);
        assert!((center.z - 3.0).abs() < 0.001);
        assert!((radius - 0.0).abs() < 0.001);
    }

    #[test]
    fn two_points_sphere() {
        let points = vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(2.0, 0.0, 0.0)];
        let (center, radius) = ritter_bounding_sphere(&points);
        assert!((center.x - 1.0).abs() < 0.001);
        assert!((radius - 1.0).abs() < 0.001);
    }

    #[test]
    fn unit_cube_sphere() {
        let points = vec![
            Vector3::new(0.0, 0.0, 0.0),
            Vector3::new(1.0, 0.0, 0.0),
            Vector3::new(0.0, 1.0, 0.0),
            Vector3::new(0.0, 0.0, 1.0),
            Vector3::new(1.0, 1.0, 0.0),
            Vector3::new(1.0, 0.0, 1.0),
            Vector3::new(0.0, 1.0, 1.0),
            Vector3::new(1.0, 1.0, 1.0),
        ];
        let (center, radius) = ritter_bounding_sphere(&points);

        // Radius should be at least half the diagonal: sqrt(3)/2 ≈ 0.866
        let half_diag = (3.0f32).sqrt() / 2.0;
        assert!(
            radius >= half_diag - 0.01,
            "radius {} >= {}",
            radius,
            half_diag
        );

        // All points must be inside the sphere
        for p in &points {
            let dist = distance(&center, p);
            assert!(
                dist <= radius + 0.001,
                "point {:?} is outside sphere (dist={}, r={})",
                p,
                dist,
                radius
            );
        }
    }

    #[test]
    fn empty_points_sphere() {
        let points: Vec<Vector3<f32>> = vec![];
        let (center, radius) = ritter_bounding_sphere(&points);
        assert_eq!(radius, 0.0);
        assert_eq!(center, Vector3::new(0.0, 0.0, 0.0));
    }

    #[test]
    fn compute_bounding_spheres_basic() {
        let vertices = vec![
            LwVector3(Vector3::new(0.0, 0.0, 0.0)),
            LwVector3(Vector3::new(1.0, 0.0, 0.0)),
            LwVector3(Vector3::new(0.0, 1.0, 0.0)),
            LwVector3(Vector3::new(0.0, 0.0, 1.0)),
        ];

        let spheres = compute_bounding_spheres(&vertices, 1);
        assert_eq!(spheres.len(), 1);
        assert_eq!(spheres[0].id, 0);

        // All vertices must be inside the sphere
        for v in &vertices {
            let dist = distance(&spheres[0].sphere.c.0, &v.0);
            assert!(
                dist <= spheres[0].sphere.r + 0.001,
                "vertex outside bounding sphere"
            );
        }
    }

    #[test]
    fn compute_bounding_spheres_multiple() {
        // Tall model - should subdivide along Y axis
        let mut vertices = vec![];
        for i in 0..100 {
            let y = i as f32 * 0.02; // 0.0 to 2.0
            vertices.push(LwVector3(Vector3::new(0.1, y, 0.1)));
            vertices.push(LwVector3(Vector3::new(-0.1, y, -0.1)));
        }

        let spheres = compute_bounding_spheres(&vertices, 4);
        assert!(spheres.len() >= 2);
        assert!(spheres.len() <= 4);
    }
}
