import { useNavigate } from "react-router-dom";
import Liver from "../components/Liver";

export default function Home() {
  const navigate = useNavigate();
  return (
    <div className="relative min-h-screen overflow-hidden bg-background-50 dark:bg-background-900">
      <Liver />
      <div className="relative z-10 flex flex-col justify-between items-center h-full py-10">
        <h1 className="text-2xl font-semibold text-gray-700 dark:text-dark-text text-center">
          Auto Liver Annotation with TotalSegmentator
        </h1>
        <button className="text-sm px-6 py-2 text-gray-700 dark:text-dark-text transition underline"
          onClick={() => navigate("/upload")}>
          Start Segmenting
        </button>
      </div>
    </div>
  );
}