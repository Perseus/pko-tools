import { SubEffect } from "@/types/effect";
import { RectPlane } from "./models/RectPlane";

interface SubEffectRendererProps {
  subEffect: SubEffect;
}

function isExternalModel(modelName: string): boolean {
  return modelName.includes('.lgo');
}

/**
 * Routes a sub-effect to the correct model renderer based on its data.
 * - No modelName + has texName → RectPlane (textured billboard quad)
 * - Has modelName → 3D model (TODO)
 * - useParam > 0 → Cylinder mesh (TODO)
 */
export function SubEffectRenderer({ subEffect }: SubEffectRendererProps) {
  const hasModel = subEffect.modelName.trim().length > 0;
  const hasCylinder = subEffect.useParam > 0;


  if (hasCylinder) {
    // TODO: CylinderMesh
    return null;
  }

  if (hasModel) {
    if (isExternalModel(subEffect.modelName)) {
      console.log('external model found, not rendering yet - ', subEffect.modelName);
      return null;
    }

    switch (subEffect.modelName) {
      case 'RectPlane':
        return <RectPlane subEffect={subEffect} />
      default:
        console.log('Got unhandled subEffect with modelName - ', subEffect.modelName);

    }
    return null;
  }

  if (subEffect.texName) {
    console.log('subeffect has name', subEffect.texName);
    return <RectPlane subEffect={subEffect} />;
  }

  return null;
}
