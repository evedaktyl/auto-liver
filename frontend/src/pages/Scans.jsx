import { useEffect, useState } from "react";

export default function Scans() {
    const [scans, setScans] = useState([]);
    const [error, setError] = useState("");

    useEffect(() => {
        fetch("http://localhost:8000/scans")
        .then((res) => {
            if (!res.ok) throw new Error("Failed to fetch scans");
            return res.json();
        })
        .then((data) => setScans(data))
        .catch((err) => setError(err.message));
    }, []);

    return (
        <div className="min-h-screen flex items-center justify-center p-4">
            <div className="max-w-2xl w-full">
                <h2 className="text-2xl font-bold mb-6">Uploaded Scans</h2>
                {error && <p className="text-red-500 mb-4">{error}</p>}
                {scans.length === 0 ? (
                    <p className="text-gray-600">No scans found.</p>
                ) : (
                    <ul className="space-y-4">
                        {scans.map((scan) => (
                            <li key={scan.scan_id}
                            className="bg-white p-4 rounded shadow flex justify-between items-center"
                            >
                                <div>
                                <p className="font-semibold">{scan.filename}</p>
                                <p className="text-sm text-gray-500">Scan type: {scan.scan_type}</p>
                                <p className="text-sm text-gray-500">
                                    Segmented: {scan.segmented ? "✅ Yes" : "❌ No"}
                                </p>
                                </div>
                                <a
                                href={`/scans/${scan.scan_id}`}
                                className="text-blue-600 hover:underline text-sm"
                                >
                                View
                                </a>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );

}