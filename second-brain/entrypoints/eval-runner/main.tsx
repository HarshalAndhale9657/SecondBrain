import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import "@/assets/tailwind.css"; // assuming we have styles

function EvalRunner() {
  const [file, setFile] = useState<File | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [total, setTotal] = useState(0);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setFile(e.target.files[0]);
    }
  };

  const runEval = async () => {
    if (!file) return;
    setIsRunning(true);
    
    const text = await file.text();
    const questions = JSON.parse(text);
    setTotal(questions.length);
    
    const logs = [];

    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      setProgress(i + 1);
      
      try {
        // We will send a message to background to handle this query silently
        const res = await chrome.runtime.sendMessage({
          type: "RUN_EVAL_QUERY",
          payload: { query: q.question }
        });

        logs.push({
          question_id: q.id,
          question: q.question,
          topology: q.topology,
          expected: q.ground_truth_answer,
          actual_answer: res.answer,
          retrieved_chunks: res.retrievedChunks,
          is_negative_case: res.isNegative,
          score: "PENDING_MANUAL_REVIEW"
        });
      } catch (err: any) {
        logs.push({ question_id: q.id, error: err.message });
      }
    }

    // Download logs
    const blob = new Blob([JSON.stringify(logs, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "eval-logs-output.json";
    a.click();

    setIsRunning(false);
  };

  return (
    <div style={{ padding: "2rem", fontFamily: "system-ui" }}>
      <h1>Second Brain - Evaluation Runner</h1>
      <p>Upload your filled <code>eval/questions.json</code> to run the pipeline against your real IndexedDB history.</p>
      <input type="file" accept=".json" onChange={handleFileChange} />
      <br /><br />
      <button 
        onClick={runEval} 
        disabled={!file || isRunning}
        style={{ padding: "8px 16px", cursor: "pointer" }}
      >
        {isRunning ? `Running... (${progress}/${total})` : "Run Evaluation"}
      </button>
    </div>
  );
}

const container = document.getElementById("root");
if (container) {
  const root = createRoot(container);
  root.render(<EvalRunner />);
}
