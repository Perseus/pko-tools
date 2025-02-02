import CharacterStatusBar from "@/features/character/CharacterStatusBar";
import { Route, Routes } from "react-router";

interface StatusBarProps {
  className?: string;
}

export default function StatusBar({ className }: StatusBarProps) {
  return (
    <footer className={`w-full bg-primary p-2 ${className} text-secondary`}>
      <Routes>
        <Route path="/characters" element={<CharacterStatusBar />} />
      </Routes>
    </footer>
  );
}
