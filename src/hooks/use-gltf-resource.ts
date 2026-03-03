import { acquireGltfResource } from "@/lib/gltfResource";
import { useEffect, useState } from "react";

export function useGltfResource(gltfJson: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!gltfJson) {
      setUrl(null);
      return;
    }

    const resource = acquireGltfResource(gltfJson);
    setUrl(resource.url);

    return () => {
      resource.release();
    };
  }, [gltfJson]);

  return url;
}
