// app/frontend/src/pages/Upload.jsx
import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";

const API = "http://localhost:8000";

export default function Upload() {
  const [files, setFiles] = useState([]);        // File[]
  const [scanType, setScanType] = useState("CT");
  const [status, setStatus] = useState("");
  const inputRef = useRef(null);
  const navigate = useNavigate();

  const onPickFiles = (e) => {
    const selected = Array.from(e.target.files || []);
    setFiles(selected);
  };

  const onDrop = (e) => {
    e.preventDefault();
    const dropped = Array.from(e.dataTransfer?.files || []);
    setFiles(dropped);
  };

  const onDragOver = (e) => e.preventDefault();

  const clearFiles = () => setFiles([]);

  const handleSubmit = async () => {
    if (!files.length) {
      setStatus("Please select at least one NIfTI file.");
      return;
    }
    setStatus("Uploading…");
    const fd = new FormData();
    // Backend expects key "files" repeated for each file
    files.forEach((f) => fd.append("files", f));
    fd.append("scan_type", scanType);

    try {
      const res = await fetch(`${API}/uploads/`, {
        method: "POST",
        body: fd,
      });
      if (!res.ok) throw new Error(`Upload failed (${res.status})`);
      const data = await res.json(); // { draft_id }
      setStatus("Uploaded. Redirecting…");
      navigate(`/drafts`);
    } catch (err) {
      console.error(err);
      setStatus("Upload failed. Check server logs.");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="p-8 bg-[#080808] rounded rounded-xl shadow max-w-xl w-full space-y-6">
        <h2 className="text-2xl">Upload Scans</h2>

        {/* Dropzone */}
        <label
          htmlFor="file-input"
          onDragOver={onDragOver}
          onDrop={onDrop}
          className="flex flex-col items-center justify-center w-full h-48 border-2 border-gray-300 border-dashed rounded-xl cursor-pointer bg-[#121212] hover:bg-[#1c1c1c]"
        >
          <div className="flex flex-col items-center justify-center p-6 text-center">
            <svg className="w-8 h-8 mb-2 text-gray-500" viewBox="0 0 20 16" aria-hidden="true">
              <path fill="currentColor" d="M13 13h3a3 3 0 0 0 0-6h-.025A5.56 5.56 0 0 0 16 6.5 5.5 5.5 0 0 0 5.207 5.021C5.137 5.017 5.071 5 5 5a4 4 0 0 0 0 8h2.167M10 15V6l-2 2 2-2 2 2" />
            </svg>
            <p className="text-sm text-gray-100">
              <span className="font-semibold">Click to select</span> or drag & drop
            </p>
            <p className="text-xs text-gray-400">NIfTI (.nii, .nii.gz). Multiple files allowed.</p>
          </div>
          <input
            id="file-input"
            ref={inputRef}
            type="file"
            className="hidden"
            multiple
            accept=".nii,.nii.gz,application/gzip"
            onChange={onPickFiles}
          />
        </label>

        {/* Selected files */}
        {files.length > 0 && (
          <div className="text-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="font-medium">Selected ({files.length}):</span>
              <button
                onClick={clearFiles}
                className="px-2 py-1 border rounded text-gray-300 hover:bg-[#121212]"
              >
                Clear
              </button>
            </div>
            <ul className="max-h-40 overflow-auto border rounded p-2 bg-[#121212]">
              {files.map((f, i) => (
                <li key={i} className="truncate">{f.name}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Scan type */}
        <div>
          <label className="block text-md text-gray-400 mb-1">
            Scan type
          </label>
          <select
            value={scanType}
            onChange={(e) => setScanType(e.target.value)}
            className="w-full border rounded rounded-lg p-2 bg-[#121212]"
          >
            <option value="CT">CT</option>
            <option value="MRI">MRI</option>
          </select>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleSubmit}
            className="px-4 py-2 rounded text-white"
            style={{ backgroundColor: "#5f9ea0" }} // Tailwind bg-blue-600 inline to avoid global button CSS conflicts
          >
            Upload
          </button>
          <button
            onClick={() => inputRef.current?.click()}
            className="px-4 py-2 border rounded"
          >
            Choose Files
          </button>
        </div>

        {status && <div className="text-sm text-gray-600">{status}</div>}
      </div>
    </div>
  );
}
