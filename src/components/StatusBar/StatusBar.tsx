import CharacterStatusBar from "@/features/character/CharacterStatusBar";
import { Route, Routes } from "react-router";

interface StatusBarProps {
  className?: string;
}

export default function StatusBar({ className }: StatusBarProps) {
  const appVersion = __APP_VERSION__;
  return (
    <footer className={`w-full flex bg-primary p-2 ${className} text-secondary`}>
      <div className="w-full">
        <Routes>
          <Route path="/characters" element={<CharacterStatusBar />} />
        </Routes>
      </div>
      <div className="ml-auto">
        pko-tools {appVersion} by Perseus
      </div>
    </footer>
  );
}
