import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Files, Folder } from 'lucide-react'

const API = "http://localhost:8000";

export default function Upload() {
  const navigate = useNavigate();

  const [files, setFiles] = useState([]);
  const [scanType, setScanType] = useState(""); // No default - user must choose
  const [status, setStatus] = useState("");
  const fileInputRef = useRef(null);
  const directoryInputRef = useRef(null);

  // Series detection state
  const [detectedSeries, setDetectedSeries] = useState([]);
  const [showSeriesDialog, setShowSeriesDialog] = useState(false);
  const [selectedSeriesUids, setSelectedSeriesUids] = useState([]);
  const [directoryFiles, setDirectoryFiles] = useState([]);
  const [directoryName, setDirectoryName] = useState("");

  const onDragOver = (e) => e.preventDefault();

  const onDrop = async (e) => {
    e.preventDefault();

    const items = Array.from(e.dataTransfer.items || []);

    const hasDirectory = items.some(item => {
      const entry = item.webkitGetAsEntry?.();
      return entry?.isDirectory;
    });

    if (hasDirectory) {
      const entry = items[0].webkitGetAsEntry();
      if (entry.isDirectory) {
        await handleDirectoryDrop(entry);
        return;
      }
    }

    // Regular file drop (non-directory)
    const dropped = Array.from(e.dataTransfer?.files || []);
    setFiles(dropped);
  };

  const handleDirectoryDrop = async (directoryEntry) => {
    setStatus("Reading directory...");
    try {
      const allFiles = await collectFilesFromDirectoryEntry(directoryEntry);
      setDirectoryName(directoryEntry.name);
      await analyzeDicomDirectory(allFiles, directoryEntry.name);
    } catch (err) {
      console.error('Directory drop error:', err);
      setStatus("Failed to read directory");
    }
  };

  const collectFilesFromDirectoryEntry = async (directoryEntry, path = "") => {
    const files = [];
    const reader = directoryEntry.createReader();

    return new Promise((resolve, reject) => {
      const readEntries = () => {
        reader.readEntries(async (entries) => {
          if (entries.length === 0) {
            resolve(files);
            return;
          }

          for (const entry of entries) {
            if (entry.isFile) {
              const file = await new Promise((res) => entry.file(res));
              files.push(new File([file], `${path}${entry.name}`, { type: file.type }));
            } else if (entry.isDirectory) {
              const subFiles = await collectFilesFromDirectoryEntry(entry, `${path}${entry.name}/`);
              files.push(...subFiles);
            }
          }

          readEntries();
        }, reject);
      };

      readEntries();
    });
  };

  const openDirectoryPicker = async () => {
    // File System Access API (Chrome/Edge)
    if ('showDirectoryPicker' in window) {
      try {
        const dirHandle = await window.showDirectoryPicker();
        setStatus("Reading directory...");
        const allFiles = await collectFilesFromDirectory(dirHandle);
        setDirectoryName(dirHandle.name);
        await analyzeDicomDirectory(allFiles, dirHandle.name);
      } catch (err) {
        if (err.name !== 'AbortError') {
          console.error(err);
          setStatus("Failed to open directory");
        }
      }
    } else {
      // Fallback to webkitdirectory (Firefox/Safari)
      directoryInputRef.current?.click();
    }
  };

  const collectFilesFromDirectory = async (directoryHandle, path = "") => {
    const files = [];

    for await (const entry of directoryHandle.values()) {
      if (entry.kind === 'file') {
        const file = await entry.getFile();
        files.push(new File([file], `${path}${entry.name}`, { type: file.type }));
      } else if (entry.kind === 'directory') {
        const subFiles = await collectFilesFromDirectory(entry, `${path}${entry.name}/`);
        files.push(...subFiles);
      }
    }

    return files;
  };

  const onPickDirectory = async (e) => {
    // Fallback handler for webkitdirectory
    const selectedFiles = Array.from(e.target.files || []);
    if (selectedFiles.length > 0) {
      setStatus("Analyzing directory...");
      const dirName = selectedFiles[0].webkitRelativePath?.split('/')[0] || "Selected folder";
      setDirectoryName(dirName);
      await analyzeDicomDirectory(selectedFiles, dirName);
    }
  };

  const analyzeDicomDirectory = async (allFiles, dirName) => {
    setStatus("Scanning for DICOM series...");

    // Send to backend for series detection
    const fd = new FormData();
    allFiles.forEach(f => fd.append("directory_files", f));

    try {
      const res = await fetch(`${API}/uploads/scan-directory`, {
        method: "POST",
        body: fd,
      });

      if (!res.ok) throw new Error(`Scan failed (${res.status})`);

      const data = await res.json();

      if (data.series.length === 0) {
        setStatus("No DICOM series detected in directory");
        return;
      }

      // Show confirmation dialog with detected series
      setDetectedSeries(data.series);
      setDirectoryFiles(allFiles);
      setSelectedSeriesUids(data.series.map(s => s.series_uid));
      setShowSeriesDialog(true);
      setStatus("");
    } catch (err) {
      console.error(err);
      setStatus("Failed to analyze directory");
    }
  };

  const toggleSeriesSelection = (seriesUid, checked) => {
    if (checked) {
      setSelectedSeriesUids([...selectedSeriesUids, seriesUid]);
    } else {
      setSelectedSeriesUids(selectedSeriesUids.filter(uid => uid !== seriesUid));
    }
  };

  const cancelSeriesDialog = () => {
    setShowSeriesDialog(false);
    setDetectedSeries([]);
    setSelectedSeriesUids([]);
    setDirectoryFiles([]);
    setStatus("");
  };

  const handleConfirmSeries = async () => {
    setShowSeriesDialog(false);

    if (!scanType) {
      setStatus("Please select a scan type (CT or MRI) before importing.");
      return;
    }

    setStatus("Converting and uploading series...");

    // Upload selected series
    const fd = new FormData();
    directoryFiles.forEach(f => fd.append("files", f));
    fd.append("is_dicom_series", "true");
    fd.append("selected_series_uids", JSON.stringify(selectedSeriesUids));
    fd.append("scan_type", scanType);

    try {
      const res = await fetch(`${API}/uploads/`, {
        method: "POST",
        body: fd,
      });

      if (!res.ok) throw new Error(`Upload failed (${res.status})`);

      const data = await res.json();
      setStatus("Upload complete. Redirecting...");
      navigate(`/drafts/${data.draft_id}`);
    } catch (err) {
      console.error(err);
      setStatus("Upload failed");
    }
  };

  const onPickFiles = (e) => {
    const selected = Array.from(e.target.files || []);
    setFiles(selected);
  };

  const clearFiles = () => setFiles([]);

  const handleSubmit = async () => {
    if (!files.length) {
      setStatus("Please select at least one file.");
      return;
    }

    if (!scanType) {
      setStatus("Please select a scan type (CT or MRI).");
      return;
    }

    setStatus("Uploading…");
    const fd = new FormData();
    files.forEach((f) => fd.append("files", f));
    fd.append("scan_type", scanType);

    try {
      const res = await fetch(`${API}/uploads/`, {
        method: "POST",
        body: fd,
      });
      if (!res.ok) throw new Error(`Upload failed (${res.status})`);
      const data = await res.json();
      setStatus("Uploaded. Redirecting…");
      navigate(`/drafts/${data.draft_id}`);
    } catch (err) {
      console.error(err);
      setStatus("Upload failed.");
    }
  };

  return (
    <div className="min-h-screen flex flex-col gap-4 items-center space-y-6 py-12">
      <h2 className="text-2xl text-text-900 dark:text-dark-text">Upload Scans</h2>
      <div className="p-8 bg-background-50 dark:bg-background-700 rounded-xl shadow space-y-6">
        {/* Dropzone */}
        <div
          onDragOver={onDragOver}
          onDrop={onDrop}
          className="flex flex-col items-center justify-center w-full h-48 border-2 border-gray-300 border-dashed rounded-xl bg-background-100 hover:bg-background-200 dark:bg-background-700 dark:hover:bg-background-500"
        >
          <div className="flex flex-col items-center justify-center p-6 text-center">
            <svg className="w-8 h-8 mb-2 text-gray-500" viewBox="0 0 20 16" aria-hidden="true">
              <path fill="currentColor" d="M13 13h3a3 3 0 0 0 0-6h-.025A5.56 5.56 0 0 0 16 6.5 5.5 5.5 0 0 0 5.207 5.021C5.137 5.017 5.071 5 5 5a4 4 0 0 0 0 8h2.167M10 15V6l-2 2 2-2 2 2" />
            </svg>
            <p className="text-sm text-gray-700 dark:text-gray-100 font-semibold">
              Drop files or folders here
            </p>
            <p className="text-xs text-gray-400 mt-1">
              NIfTI (.nii, .nii.gz), DICOM (.dcm, no ext)
            </p>
            <p className="text-xs text-gray-400">
              DICOM folders auto-detect series
            </p>
          </div>
        </div>

        {/* Hidden file inputs */}
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          multiple
          accept=".nii,.nii.gz,application/gzip,.dcm"
          onChange={onPickFiles}
        />
        <input
          ref={directoryInputRef}
          type="file"
          className="hidden"
          webkitdirectory=""
          multiple
          onChange={onPickDirectory}
        />

        {/* Display selected files */}
        {files.length > 0 && (
          <div className="text-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="text-text-900 dark:text-dark-text">Selected ({files.length}):</span>
              <button
                onClick={clearFiles}
                className="px-2 py-1 rounded text-text-900 dark:text-gray-300"
              >
                Clear
              </button>
            </div>
            <ul className="max-h-40 overflow-auto border rounded p-2 bg-background-50 dark:bg-background-900">
              {files.map((f, i) => (
                <li key={i} className="truncate">{f.name}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Select scan type */}
        <div className="text-sm">
          <label className="block text-gray-600 dark:text-gray-300 mb-1">
            Scan type <span className="text-red-500">*</span>
          </label>
          <select
            value={scanType}
            onChange={(e) => setScanType(e.target.value)}
            className={`w-full border rounded-lg p-2 bg-background-50 dark:bg-background-900 ${
              !scanType ? 'text-gray-400' : ''
            }`}
          >
            <option value="" disabled>Select scan type...</option>
            <option value="CT">CT</option>
            <option value="MRI">MRI</option>
          </select>
        </div>

        {/* Actions */}
        <div className="flex justify-between gap-x-3">
          <div className="flex gap-x-3">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="px-4 py-2 border rounded border-gray-900 hover:border-gray-900/20 dark:border-gray-50"
            >
              <Files className="w-5 h-5 inline-block mr-2" />
              Choose NIfTI File(s)
            </button>
            <button
              onClick={openDirectoryPicker}
              className="px-4 py-2 border rounded border-gray-900 hover:border-gray-900/20 dark:border-gray-50"
            >
              <Folder className="w-5 h-5 inline-block mr-2" />
              Choose DICOM Folder
            </button>
          </div>
          <button
            onClick={handleSubmit}
            className="px-4 py-2 rounded text-white bg-accent-500 dark:bg-dark-accent hover:bg-[#90b6b6] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Upload
          </button>
        </div>

        {status && <div className="text-sm text-gray-600 dark:text-gray-300">{status}</div>}
      </div>

      {/* Series Confirmation Dialog */}
      {showSeriesDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-background-700 rounded-lg p-6 max-w-2xl w-full max-h-[80vh] overflow-auto mx-4">
            <h3 className="text-xl font-bold mb-4 text-text-900 dark:text-dark-text">
              Detected DICOM Series
            </h3>

            <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
              Found {detectedSeries.length} series in "{directoryName}". Select which to import:
            </p>

            <div className="space-y-3 mb-6">
              {detectedSeries.map(series => (
                <label
                  key={series.series_uid}
                  className="flex items-start gap-3 p-3 border rounded hover:bg-background-50 dark:hover:bg-background-500 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selectedSeriesUids.includes(series.series_uid)}
                    onChange={(e) => toggleSeriesSelection(series.series_uid, e.target.checked)}
                    className="mt-1"
                  />
                  <div className="flex-1">
                    <div className="font-semibold text-text-900 dark:text-dark-text">
                      Series {series.series_number}: {series.series_description}
                    </div>
                    <div className="text-sm text-gray-600 dark:text-gray-400">
                      {series.modality} • {series.num_slices} slices
                    </div>
                    {series.patient_id && series.patient_id !== 'None' && (
                      <div className="text-xs text-gray-500">
                        Patient ID: {series.patient_id}
                      </div>
                    )}
                  </div>
                </label>
              ))}
            </div>

            <div className="flex justify-end gap-3">
              <button
                onClick={cancelSeriesDialog}
                className="px-4 py-2 border rounded hover:bg-background-50 dark:hover:bg-background-500 dark:border-gray-500"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmSeries}
                disabled={selectedSeriesUids.length === 0}
                className="px-4 py-2 bg-accent-500 text-white rounded hover:bg-accent-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Import {selectedSeriesUids.length} Series
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
