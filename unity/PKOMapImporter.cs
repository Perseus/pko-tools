using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEngine;

/// <summary>
/// Unity Editor tool to import PKO map exports.
///
/// Expected directory structure:
///   Assets/Maps/{map_name}/terrain.gltf
///   Assets/Maps/{map_name}/manifest.json
///   Assets/Maps/Buildings/{building}.gltf   (shared across all maps)
///
/// Usage:
/// 1. Import your exported files into the above structure
/// 2. Open Tools > PKO Map Importer
/// 3. Select the manifest.json for the map you want to import
/// 4. Click "Import Map"
///
/// Coordinate system notes:
/// The manifest positions are in glTF right-handed Y-up space.
/// Unity uses left-handed Y-up. Most glTF importers (glTFast, UnityGLTF)
/// negate the Z axis when importing. This script does the same for placements
/// so buildings align with the imported terrain mesh.
/// </summary>
public class PKOMapImporter : EditorWindow
{
    private const string BUILDINGS_FOLDER = "Assets/Maps/Buildings";

    private string manifestPath = "";
    private string buildingsFolder = BUILDINGS_FOLDER;
    private bool groupByBuildingType = true;
    private bool flipZ = true;
    private bool generateCollision = true;
    private Vector2 scrollPos;
    private ManifestData lastManifest;
    private string lastStatus = "";

    private string mapFolder = "";

    [MenuItem("Tools/PKO Map Importer")]
    public static void ShowWindow()
    {
        GetWindow<PKOMapImporter>("PKO Map Importer");
    }

    private void OnGUI()
    {
        scrollPos = EditorGUILayout.BeginScrollView(scrollPos);

        GUILayout.Label("PKO Map Importer", EditorStyles.boldLabel);
        GUILayout.Space(5);

        // Manifest selection
        EditorGUILayout.BeginHorizontal();
        manifestPath = EditorGUILayout.TextField("Manifest JSON", manifestPath);
        if (GUILayout.Button("Browse", GUILayout.Width(60)))
        {
            string startDir = Directory.Exists(Path.Combine(Application.dataPath, "Maps"))
                ? Path.Combine(Application.dataPath, "Maps")
                : Application.dataPath;
            string path = EditorUtility.OpenFilePanel("Select manifest.json", startDir, "json");
            if (!string.IsNullOrEmpty(path))
            {
                if (path.StartsWith(Application.dataPath))
                    manifestPath = "Assets" + path.Substring(Application.dataPath.Length);
                else
                    manifestPath = path;
            }
        }
        EditorGUILayout.EndHorizontal();

        if (!string.IsNullOrEmpty(manifestPath))
        {
            mapFolder = Path.GetDirectoryName(manifestPath).Replace('\\', '/');
            EditorGUI.indentLevel++;
            EditorGUILayout.LabelField("Map Folder", mapFolder, EditorStyles.miniLabel);
            EditorGUI.indentLevel--;
        }

        GUILayout.Space(5);
        buildingsFolder = EditorGUILayout.TextField("Buildings Folder", buildingsFolder);
        groupByBuildingType = EditorGUILayout.Toggle("Group by Building Type", groupByBuildingType);
        flipZ = EditorGUILayout.Toggle("Flip Z (right\u2192left hand)", flipZ);
        generateCollision = EditorGUILayout.Toggle("Generate Collision Mesh", generateCollision);

        GUILayout.Space(10);

        if (GUILayout.Button("Preview Manifest"))
            PreviewManifest();

        if (lastManifest != null)
        {
            GUILayout.Space(5);
            string collisionInfo = lastManifest.collision_grid != null
                ? $"\nCollision Grid: {lastManifest.collision_grid.width}x{lastManifest.collision_grid.height}"
                : "\nCollision Grid: not available";
            string regionInfo = lastManifest.region_grid != null
                ? $"\nRegion Grid: {lastManifest.region_grid.width}x{lastManifest.region_grid.height}"
                : "";
            EditorGUILayout.HelpBox(
                $"Map: {lastManifest.map_name}\n" +
                $"World Scale: {lastManifest.world_scale}\n" +
                $"Unique Buildings: {lastManifest.buildings.Count}\n" +
                $"Total Placements: {lastManifest.placements.Length}" +
                collisionInfo + regionInfo,
                MessageType.Info);
        }

        GUILayout.Space(10);

        GUI.enabled = !string.IsNullOrEmpty(manifestPath);
        if (GUILayout.Button("Import Map", GUILayout.Height(30)))
            ImportMap();
        GUI.enabled = true;

        if (!string.IsNullOrEmpty(lastStatus))
        {
            GUILayout.Space(5);
            EditorGUILayout.HelpBox(lastStatus, MessageType.Info);
        }

        EditorGUILayout.EndScrollView();
    }

    private void PreviewManifest()
    {
        try
        {
            lastManifest = ParseManifest(File.ReadAllText(ResolveManifestPath()));
            lastStatus = "";
        }
        catch (Exception e)
        {
            lastManifest = null;
            lastStatus = $"Error: {e.Message}";
        }
    }

    private string ResolveManifestPath()
    {
        if (manifestPath.StartsWith("Assets"))
            return Path.Combine(Path.GetDirectoryName(Application.dataPath), manifestPath);
        return manifestPath;
    }

    private void ImportMap()
    {
        try
        {
            string json = File.ReadAllText(ResolveManifestPath());
            ManifestData manifest = ParseManifest(json);
            lastManifest = manifest;

            float s = manifest.world_scale;
            float zSign = flipZ ? -1f : 1f;

            GameObject mapRoot = new GameObject($"Map_{manifest.map_name}");
            Undo.RegisterCreatedObjectUndo(mapRoot, "Import PKO Map");

            // Terrain
            GameObject terrainPrefab = FindAssetInFolder("terrain", mapFolder);
            if (terrainPrefab != null)
            {
                GameObject terrain = (GameObject)PrefabUtility.InstantiatePrefab(terrainPrefab);
                terrain.name = "Terrain";
                terrain.transform.SetParent(mapRoot.transform);
                Debug.Log($"[PKO Map Importer] Terrain found: {AssetDatabase.GetAssetPath(terrainPrefab)}");
            }
            else
            {
                Debug.LogWarning(
                    $"[PKO Map Importer] Terrain prefab not found in '{mapFolder}'. " +
                    "Import terrain.gltf and make sure it's in the same folder as manifest.json.");
            }

            // Collision mesh
            if (generateCollision && manifest.collision_grid != null)
            {
                GameObject collisionObj = BuildCollisionMesh(manifest, zSign);
                if (collisionObj != null)
                {
                    collisionObj.transform.SetParent(mapRoot.transform);
                    Debug.Log($"[PKO Map Importer] Collision mesh generated: {manifest.collision_grid.width}x{manifest.collision_grid.height}");
                }
            }

            // Buildings
            GameObject buildingsRoot = new GameObject("Buildings");
            buildingsRoot.transform.SetParent(mapRoot.transform);

            Dictionary<int, GameObject> prefabCache = new Dictionary<int, GameObject>();
            Dictionary<int, GameObject> typeGroups = new Dictionary<int, GameObject>();

            int placed = 0;
            int skipped = 0;
            HashSet<int> missingIds = new HashSet<int>();

            foreach (Placement p in manifest.placements)
            {
                if (!prefabCache.ContainsKey(p.obj_id))
                {
                    GameObject prefab = null;
                    if (manifest.buildings.TryGetValue(p.obj_id, out BuildingInfo info))
                    {
                        string stem = Path.GetFileNameWithoutExtension(info.gltf);
                        prefab = FindAssetInFolder(stem, buildingsFolder);

                        if (prefab == null)
                        {
                            string lmoStem = Path.GetFileNameWithoutExtension(info.filename);
                            prefab = FindAssetInFolder(lmoStem, buildingsFolder);
                        }

                        if (prefab == null && !missingIds.Contains(p.obj_id))
                        {
                            Debug.LogWarning($"[PKO Map Importer] Building prefab not found for obj_id={p.obj_id} ({info.filename})");
                            missingIds.Add(p.obj_id);
                        }
                    }
                    prefabCache[p.obj_id] = prefab;
                }

                GameObject buildingPrefab = prefabCache[p.obj_id];
                if (buildingPrefab == null)
                {
                    skipped++;
                    continue;
                }

                Transform parent = buildingsRoot.transform;
                if (groupByBuildingType)
                {
                    if (!typeGroups.ContainsKey(p.obj_id))
                    {
                        string groupName = manifest.buildings.TryGetValue(p.obj_id, out BuildingInfo bi)
                            ? Path.GetFileNameWithoutExtension(bi.filename)
                            : $"type_{p.obj_id}";
                        GameObject group = new GameObject(groupName);
                        group.transform.SetParent(buildingsRoot.transform);
                        typeGroups[p.obj_id] = group;
                    }
                    parent = typeGroups[p.obj_id].transform;
                }

                GameObject instance = (GameObject)PrefabUtility.InstantiatePrefab(buildingPrefab);
                instance.transform.SetParent(parent);

                instance.transform.localPosition = new Vector3(
                    p.position[0] * s,
                    p.position[1] * s,
                    p.position[2] * s * zSign
                );

                float yaw = flipZ ? -p.rotation_y_degrees : p.rotation_y_degrees;
                instance.transform.localRotation = Quaternion.Euler(0f, yaw, 0f);

                if (p.scale != 0)
                {
                    float scaleVal = p.scale / 100f;
                    instance.transform.localScale = Vector3.one * scaleVal;
                }

                instance.name = $"{buildingPrefab.name}_{placed}";
                placed++;

                if (placed % 500 == 0)
                {
                    EditorUtility.DisplayProgressBar(
                        "Importing Map",
                        $"Placed {placed} / {manifest.placements.Length} buildings...",
                        (float)placed / manifest.placements.Length);
                }
            }

            EditorUtility.ClearProgressBar();
            lastStatus = $"Done! Placed {placed} buildings, skipped {skipped} (missing prefabs).";
            if (missingIds.Count > 0)
                lastStatus += $"\n{missingIds.Count} building types not found in {buildingsFolder}";
            Debug.Log($"[PKO Map Importer] {lastStatus}");

            Selection.activeGameObject = mapRoot;
        }
        catch (Exception e)
        {
            EditorUtility.ClearProgressBar();
            lastStatus = $"Error: {e.Message}";
            Debug.LogError($"[PKO Map Importer] {e}");
        }
    }

    // ========================================================================
    // Collision mesh generation
    // ========================================================================

    /// <summary>
    /// Build a flat quad mesh where only blocked sub-tiles have geometry.
    /// This can be used as a collision/NavMesh source in Unity.
    /// The mesh sits at Y=0 with a MeshCollider attached.
    /// A second object "WalkableArea" covers the walkable tiles for NavMesh baking.
    /// </summary>
    private GameObject BuildCollisionMesh(ManifestData manifest, float zSign)
    {
        CollisionGrid grid = manifest.collision_grid;
        if (grid == null || string.IsNullOrEmpty(grid.data))
            return null;

        byte[] data = Convert.FromBase64String(grid.data);
        if (data.Length != grid.width * grid.height)
        {
            Debug.LogWarning($"[PKO Map Importer] Collision data size mismatch: expected {grid.width * grid.height}, got {data.Length}");
            return null;
        }

        float s = manifest.world_scale;
        float subTileSize = grid.tile_size * s; // world-space size of one sub-tile

        // Count blocked cells for pre-allocation
        int blockedCount = 0;
        for (int i = 0; i < data.Length; i++)
            if (data[i] != 0) blockedCount++;

        if (blockedCount == 0)
        {
            Debug.Log("[PKO Map Importer] No blocked tiles found in collision grid.");
            return null;
        }

        // Build mesh: one quad (2 tris) per blocked sub-tile
        Vector3[] vertices = new Vector3[blockedCount * 4];
        int[] triangles = new int[blockedCount * 6];
        int vi = 0;
        int ti = 0;

        for (int sy = 0; sy < grid.height; sy++)
        {
            for (int sx = 0; sx < grid.width; sx++)
            {
                int idx = sy * grid.width + sx;
                if (data[idx] == 0) continue;

                // World position of this sub-tile's corners
                float x0 = sx * subTileSize;
                float x1 = (sx + 1) * subTileSize;
                float z0 = sy * subTileSize * zSign;
                float z1 = (sy + 1) * subTileSize * zSign;

                vertices[vi + 0] = new Vector3(x0, 0, z0);
                vertices[vi + 1] = new Vector3(x1, 0, z0);
                vertices[vi + 2] = new Vector3(x1, 0, z1);
                vertices[vi + 3] = new Vector3(x0, 0, z1);

                // Winding order depends on Z flip
                if (flipZ)
                {
                    triangles[ti + 0] = vi + 0;
                    triangles[ti + 1] = vi + 3;
                    triangles[ti + 2] = vi + 1;
                    triangles[ti + 3] = vi + 1;
                    triangles[ti + 4] = vi + 3;
                    triangles[ti + 5] = vi + 2;
                }
                else
                {
                    triangles[ti + 0] = vi + 0;
                    triangles[ti + 1] = vi + 1;
                    triangles[ti + 2] = vi + 3;
                    triangles[ti + 3] = vi + 1;
                    triangles[ti + 4] = vi + 2;
                    triangles[ti + 5] = vi + 3;
                }

                vi += 4;
                ti += 6;
            }
        }

        Mesh blockedMesh = new Mesh();
        blockedMesh.name = "collision_blocked";
        if (vertices.Length > 65535)
            blockedMesh.indexFormat = UnityEngine.Rendering.IndexFormat.UInt32;
        blockedMesh.vertices = vertices;
        blockedMesh.triangles = triangles;
        blockedMesh.RecalculateNormals();

        // Parent object
        GameObject collisionRoot = new GameObject("Collision");

        // Blocked areas — visible in editor, has MeshCollider
        GameObject blockedObj = new GameObject("BlockedAreas");
        blockedObj.transform.SetParent(collisionRoot.transform);
        blockedObj.layer = LayerMask.NameToLayer("Default");

        MeshFilter mf = blockedObj.AddComponent<MeshFilter>();
        mf.sharedMesh = blockedMesh;

        MeshCollider mc = blockedObj.AddComponent<MeshCollider>();
        mc.sharedMesh = blockedMesh;

        // Semi-transparent red material so you can see blocked areas in scene view
        MeshRenderer mr = blockedObj.AddComponent<MeshRenderer>();
        Material mat = new Material(Shader.Find("Standard"));
        mat.color = new Color(1f, 0f, 0f, 0.3f);
        mat.SetFloat("_Mode", 3); // Transparent
        mat.SetInt("_SrcBlend", (int)UnityEngine.Rendering.BlendMode.SrcAlpha);
        mat.SetInt("_DstBlend", (int)UnityEngine.Rendering.BlendMode.OneMinusSrcAlpha);
        mat.SetInt("_ZWrite", 0);
        mat.DisableKeyword("_ALPHATEST_ON");
        mat.EnableKeyword("_ALPHABLEND_ON");
        mat.DisableKeyword("_ALPHAPREMULTIPLY_ON");
        mat.renderQueue = 3000;
        mr.sharedMaterial = mat;

        Debug.Log($"[PKO Map Importer] Collision: {blockedCount} blocked sub-tiles out of {data.Length} total");
        return collisionRoot;
    }

    // ========================================================================
    // Asset search
    // ========================================================================

    private GameObject FindAssetInFolder(string name, string folder)
    {
        if (string.IsNullOrEmpty(folder) || !AssetDatabase.IsValidFolder(folder))
            return null;

        string[] guids = AssetDatabase.FindAssets(name, new[] { folder });

        foreach (string guid in guids)
        {
            string path = AssetDatabase.GUIDToAssetPath(guid);
            string assetName = Path.GetFileNameWithoutExtension(path);

            if (string.Equals(assetName, name, StringComparison.OrdinalIgnoreCase))
            {
                GameObject obj = AssetDatabase.LoadAssetAtPath<GameObject>(path);
                if (obj != null) return obj;
            }
        }

        return null;
    }

    // ========================================================================
    // JSON parsing
    // ========================================================================

    private ManifestData ParseManifest(string json)
    {
        ManifestShell shell = JsonUtility.FromJson<ManifestShell>(json);

        ManifestData data = new ManifestData
        {
            map_name = shell.map_name,
            coordinate_system = shell.coordinate_system,
            world_scale = shell.world_scale,
            terrain_gltf = shell.terrain_gltf,
            placements = shell.placements,
            buildings = new Dictionary<int, BuildingInfo>()
        };

        ParseBuildingsDict(json, data.buildings);
        data.collision_grid = ParseGrid(json, "collision_grid");
        data.region_grid = ParseGrid(json, "region_grid");

        return data;
    }

    private CollisionGrid ParseGrid(string json, string fieldName)
    {
        string key = $"\"{fieldName}\"";
        int start = json.IndexOf(key);
        if (start < 0) return null;

        int braceStart = json.IndexOf('{', start + key.Length);
        if (braceStart < 0) return null;

        int depth = 1;
        int pos = braceStart + 1;
        while (pos < json.Length && depth > 0)
        {
            if (json[pos] == '{') depth++;
            else if (json[pos] == '}') depth--;
            pos++;
        }

        string gridJson = json.Substring(braceStart, pos - braceStart);
        return JsonUtility.FromJson<CollisionGrid>(gridJson);
    }

    private void ParseBuildingsDict(string json, Dictionary<int, BuildingInfo> buildings)
    {
        int buildingsStart = json.IndexOf("\"buildings\"");
        if (buildingsStart < 0) return;

        int braceStart = json.IndexOf('{', buildingsStart + 10);
        if (braceStart < 0) return;

        int depth = 1;
        int pos = braceStart + 1;
        while (pos < json.Length && depth > 0)
        {
            if (json[pos] == '{') depth++;
            else if (json[pos] == '}') depth--;
            pos++;
        }

        string buildingsJson = json.Substring(braceStart, pos - braceStart);

        int i = 1;
        while (i < buildingsJson.Length)
        {
            int keyStart = buildingsJson.IndexOf('"', i);
            if (keyStart < 0) break;
            int keyEnd = buildingsJson.IndexOf('"', keyStart + 1);
            if (keyEnd < 0) break;

            string keyStr = buildingsJson.Substring(keyStart + 1, keyEnd - keyStart - 1);
            if (!int.TryParse(keyStr, out int objId))
            {
                i = keyEnd + 1;
                continue;
            }

            int valStart = buildingsJson.IndexOf('{', keyEnd);
            if (valStart < 0) break;
            int valEnd = buildingsJson.IndexOf('}', valStart);
            if (valEnd < 0) break;

            string valJson = buildingsJson.Substring(valStart, valEnd - valStart + 1);
            BuildingInfo info = JsonUtility.FromJson<BuildingInfo>(valJson);
            buildings[objId] = info;

            i = valEnd + 1;
        }
    }

    // ========================================================================
    // Data classes
    // ========================================================================

    [Serializable]
    private class ManifestShell
    {
        public string map_name;
        public string coordinate_system;
        public float world_scale;
        public string terrain_gltf;
        public Placement[] placements;
    }

    private class ManifestData
    {
        public string map_name;
        public string coordinate_system;
        public float world_scale;
        public string terrain_gltf;
        public Dictionary<int, BuildingInfo> buildings;
        public Placement[] placements;
        public CollisionGrid collision_grid;
        public CollisionGrid region_grid;
    }

    [Serializable]
    private class CollisionGrid
    {
        public int width;
        public int height;
        public float tile_size;
        public string description;
        public string data;
    }

    [Serializable]
    private class BuildingInfo
    {
        public string gltf;
        public string filename;
    }

    [Serializable]
    private class Placement
    {
        public int obj_id;
        public float[] position;
        public float rotation_y_degrees;
        public float scale;
    }
}
