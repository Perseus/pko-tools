import { acquireGltfResource } from "@/lib/gltfResource";
import { useEffect, useState } from "react";

export function useGltfResource(gltfJson: string | null | undefined): string | null {
  const [resource, setResource] = useState<{
    source: string;
    url: string;
  } | null>(null);

  useEffect(() => {
    if (!gltfJson) {
      setResource(null);
      return;
    }

    const resource = acquireGltfResource(gltfJson);
    setResource({
      source: gltfJson,
      url: resource.url,
    });

    return () => {
      resource.release();
    };
  }, [gltfJson]);

  if (!gltfJson || resource?.source !== gltfJson) {
    return null;
  }

  return resource.url;
}
