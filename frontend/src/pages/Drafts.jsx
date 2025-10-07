import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

// const API="http://localhost:8000";
const API = "https://breach-merit-hundred-varies.trycloudflare.com";

export default function Drafts() {
  const [drafts, setDrafts] = useState([]);     // [{draft_id, title, scan_type, items:[...]}]
  const [progress, setProgress] = useState({}); // draftId -> {done, total, state}
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const navigate = useNavigate();

  const fetchDrafts = async () => {
    setLoading(true);
    setErr("");
    try {
      const r = await fetch(`${API}/drafts/`);
      if (!r.ok) throw new Error(`Failed (${r.status})`);
      const data = await r.json();
      setDrafts(data);
    } catch (e) {
      setErr("Failed to load drafts");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchDrafts(); }, []);

  const countSegmented = (itms=[]) => itms.filter(i => i.segmented).length;

  const segmentAllInDraft = async (draftId, items) => {
    const todo = items.filter(i => !i.segmented);
    setProgress(p => ({ ...p, [draftId]: { done: 0, total: todo.length, state: "running" } }));
    for (let i = 0; i < todo.length; i++) {
      const it = todo[i];
      try {
        const r = await fetch(`${API}/drafts/${draftId}/segment?item=${encodeURIComponent(it.item_id)}`, { method: "POST" });
        if (!r.ok) throw new Error();
        setProgress(p => ({ ...p, [draftId]: { done: i+1, total: todo.length, state: "running" } }));
      } catch {
        setProgress(p => ({ ...p, [draftId]: { done: i, total: todo.length, state: "error" } }));
        break;
      }
    }
    // refresh data + finalize state
    await fetchDrafts();
    setProgress(p => {
      const cur = p[draftId];
      if (!cur) return p;
      const finalState = cur.state === "error" ? "error" : "done";
      return { ...p, [draftId]: { ...cur, state: finalState } };
    });
  };

  const saveAllInDraft = async (draftId) => {
    // const r = await fetch(`${API}/drafts/${draftId}/save_all`, { method: "POST" });
    // if (!r.ok) return;
    
    await fetchDrafts();
  };

  if (loading) return <div className="p-6">Loading…</div>;
  if (err) return <div className="p-6 text-red-600">{err}</div>;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Current Uploads</h1>
        <button onClick={fetchDrafts} className="px-3 py-2 border rounded hover:bg-gray-50">
          Refresh
        </button>
      </div>

      {drafts.length === 0 && (
        <div className="p-4 border rounded bg-gray-50">No drafts yet.</div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {drafts.map(d => {
          const total = d.items?.length || 0;
          const seg = countSegmented(d.items);
          const pr = progress[d.draft_id];
          const state = pr?.state || "idle";
          const pct = pr ? (pr.total ? Math.round((pr.done / pr.total) * 100) : 100) : 0;

          const badge =
            state === "running" ? "bg-yellow-100 text-yellow-800" :
            state === "error"   ? "bg-red-100 text-red-800" :
            state === "done"    ? "bg-green-100 text-green-800" :
                                  "bg-gray-100 text-gray-800";

          return (
            <div key={d.draft_id} className="border border-accent-500 rounded p-4 bg-white dark:bg-background-500 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div className="font-semibold truncate">
                  {d.title ? d.title : `Draft ${d.draft_id}`}
                </div>
                <span className={`text-xs px-2 py-1 rounded bg-background-50 dark:bg-background-200 ${badge}`}>
                  {state === "idle" ? (seg === total ? "all segmented" : "idle") : state}
                </span>
              </div>

              <div className="text-sm text-gray-600 dark:text-dark-text space-y-1">
                <div><span className="font-medium">Type:</span> {d.scan_type}</div>
                <div><span className="font-medium">Items:</span> {total} ({seg} segmented)</div>
              </div>

              {state === "running" && (
                <div className="w-full bg-gray-100 rounded h-2">
                  <div className="h-2 rounded"
                       style={{ width: `${pct}%`, backgroundColor: "#2563eb" }} />
                </div>
              )}

              <div className="mt-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                <button
                  onClick={() => navigate(`/drafts/${d.draft_id}`)}
                  className="px-3 py-2 border rounded"
                >
                  Open
                </button>
                <button
                  onClick={() => segmentAllInDraft(d.draft_id, d.items || [])}
                  disabled={state === "running"}
                  hidden={(d.items || []).every(i => i.segmented)}
                  className={`px-3 py-2 rounded text-white bg-accent-500 ${state === "running" ? "opacity-60 cursor-not-allowed" : ""}`}
                >
                  {state === "running" ? "Segmenting…" : "Segment All"}
                </button>
                <button
                  onClick={() => saveAllInDraft(d.draft_id)}
                  className="px-3 py-2 border rounded"
                  disabled
                >
                  Save All
                </button>
                </div>
                <button
                  onClick={() => deleteDraft(d.draft_id)}
                  className="px-3 py-2 border rounded"
                  disabled>
                  Clear
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
