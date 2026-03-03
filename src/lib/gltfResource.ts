type GltfResourceEntry = {
  url: string;
  refCount: number;
};

type GltfResourceHandle = {
  url: string;
  release: () => void;
};

const cache = new Map<string, GltfResourceEntry>();

export function acquireGltfResource(gltfJson: string): GltfResourceHandle {
  let entry = cache.get(gltfJson);
  if (!entry) {
    const blob = new Blob([gltfJson], { type: "model/gltf+json" });
    entry = {
      url: URL.createObjectURL(blob),
      refCount: 0,
    };
    cache.set(gltfJson, entry);
  }

  entry.refCount += 1;

  let released = false;
  return {
    url: entry.url,
    release: () => {
      if (released) {
        return;
      }
      released = true;

      const current = cache.get(gltfJson);
      if (!current) {
        return;
      }

      current.refCount -= 1;
      if (current.refCount <= 0) {
        URL.revokeObjectURL(current.url);
        cache.delete(gltfJson);
      }
    },
  };
}

export function clearGltfResourceCache(): void {
  cache.forEach((entry) => {
    URL.revokeObjectURL(entry.url);
  });
  cache.clear();
}
