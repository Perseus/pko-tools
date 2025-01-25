import CharacterStatusBar from "@/features/character/CharacterStatusBar";
import { Route, Routes, useLocation } from "react-router";

interface StatusBarProps {
  className?: string;
}

export default function StatusBar({ className }: StatusBarProps) {
  const location = useLocation();
  return (
    <footer className={`w-full bg-primary p-2 ${className} text-secondary`}>
      {location.pathname}

      <Routes>
        <Route path="/animations" element={<CharacterStatusBar />} />
      </Routes>
    </footer>
  );
}
