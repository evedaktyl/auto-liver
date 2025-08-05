import { useParams } from "react-router-dom";
import { useEffect, useState } from "react";
export default function ScanDetail() {
    const { scanId } = useParams();
    const [scan, setScan] = useState(null);
    const [error, setError] = useState("");

    useEffect(() => {
        fetch(`http://localhost:8000/scans/${scanId}`)
        .then((res) => {
            if (!res.ok) throw new Error("Scan not found");
            return res.json();
        })
        .then((data) => setScan(data))
        .catch((err) => setError(err.message));
    }, [scanId]);

    if (error) return <p className="text-red-500">{error}</p>;
    if (!scan) return <p>Loading...</p>;

    return (
        <div>
            <div>
                <h2>{scan.filename}</h2>
                <p><strong>Scan type: </strong>{scan.scan_type}</p>
                <p><strong>Segmented: </strong>{scan.segmented ? "✅ Yes" : "❌ No"}</p>
                <p><strong>Path:</strong> {scan.path}</p>
            </div>
        </div>
    )
}