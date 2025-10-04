import Liver from "../components/Liver";

export default function Home() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-background-50 dark:bg-background-900">
      <Liver />
      <div className="relative z-10 flex h-full items-center justify-center">
        <h1 className="text-4xl font-semibold text-gray-700 dark:text-dark-text">
          Welcome to Your Landing Page
        </h1>
      </div>
    </div>
  );
}
