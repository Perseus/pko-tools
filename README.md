# TOP/PKO Client Assets Tool

This tool is designed for converting game client assets into standard formats (such as glTF) and back again. It enables the import, editing, and export of various game assets, with an initial focus on character models.

> **Note:** The tool is currently in *alpha*. While exporting assets generally works well, the importing functionality is limited to basic character models (i.e., models with a single mesh file). Complex models (such as those with multiple mesh files or subsequences) may not import correctly at this time.

---

## Features

- **Exporting to glTF:**  
  Convert character models—including mesh, animations, and texture data—into a glTF file for use in 3D art tools like Blender.

- **Importing from glTF:**  
  Re-import modified glTF files to regenerate the required character assets for in-game rendering (i.e., `.lab` for animations, `.lgo` for meshes, and `.bmp` for textures).

- **In-Tool Preview:**  
  View a list of characters from your client’s `CharacterInfo.txt`, inspect models, and preview animations directly within the tool.

---

## Setup

1. **Client Folder:**  
   Upon opening the application, you will be prompted to select your game client folder. The tool will scan this folder for asset files.

2. **CharacterInfo.txt:**  
   Ensure that you have a decompiled `CharacterInfo.txt` file located in the `scripts/table` folder of your client.  
   > **Important:** The tool does not support parsing `.bin` files into `CharacterInfo.txt`.

3. **User Interface:**  
   Once the client folder and `CharacterInfo.txt` are provided, the tool will display its UI, which includes a searchable list of characters and their respective models and animations.

![Client UI](https://i.gyazo.com/784870bb1ed90c5d9b1833c36c057cec.png "Client.png")

---

## Usage Guide

### Exporting to glTF

- Click the **"Export to glTF"** button.
- The tool will generate a `.glTF` file that contains the character's mesh, animations, and texture data.
- The exported file is saved to the `exports/gltf` folder located next to the tool’s installation directory.
- **Editing in Blender:**  
  When exporting from Blender, ensure the following settings are applied:
  1. **Animation:** Turn **"Sampling animations"** **OFF**.
  2. **Data > Armature:** Turn **"Remove Armature Object"** **ON**.
  3. **Include > Data:** Turn **"Custom Properties"** **ON**.

### Importing from glTF

- Click the **"Import from glTF"** button.
- Select the modified `.glTF` or `.glb` file.
- Provide a **model ID**. This ID should match the one referenced in your `CharacterInfo.txt` for the corresponding character.
- Upon successful import, the regenerated assets (`.lgo`, `.lab`, and texture `.bmp`) will be saved in the `imports/character/` folder next to the application.
- These assets can then be integrated back into your game client.

---

## Limitations

- **Complex Models:**  
  - Importing fails for models with multiple mesh files or multiple subsequences (i.e., different parts of the mesh having distinct texture mappings).
  - Although exporting works for complex models, some alignment issues may occur (e.g., wing scaling issues in certain models like the Black Dragon).

- **Clickable Areas:**  
  - The in-game clickable areas (bounding spheres) might be slightly off. These are configurable via bone properties (e.g., "Bounding Spheres") to adjust the radius.

- **Coverage:**  
  - Not all monsters have been thoroughly tested. If you encounter issues with specific models, please submit a bug report with details.

---

## Roadmap

- **Enhanced Character Importing:**  
  Extend support to import characters beyond TOP/PKO, addressing edge cases as they arise.

- **Item and Apparel Support:**  
  Introduce the ability to import/export items and apparels, including new weapon models.

- **Building Assets:**  
  Add support for building assets (i.e., `.lmo` files).

- **Effect Files:**  
  Investigate support for effect files (e.g., `.par`, `.eff`) to allow their export to standard formats.

---

## Reporting Issues

If you encounter any bugs or have questions regarding the tool, please file an issue in the repository. Detailed bug reports (including model specifics and steps to reproduce) will help improve the tool.

---

## Additional Notes

- **Code Status:**  
  The codebase is in active development and may be refactored. Contributions for code cleanup and improvements are appreciated.

- **Platform Trust:**  
  You might see an "untrusted" warning on Windows installations. This is due to the current unsigned status of the application, and it will be addressed in future updates.

---