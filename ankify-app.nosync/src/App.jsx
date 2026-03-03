import React, { useState } from 'react';
import { Upload, FileText, Download, Sparkles, Trash2, Settings, AlertCircle, Loader2 } from 'lucide-react';

export default function App() {
  const [file, setFile] = useState(null);
  const [pdfText, setPdfText] = useState('');
  const [isExtracting, setIsExtracting] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [cards, setCards] = useState([]);
  const [error, setError] = useState(null);
  const [focusMode, setFocusMode] = useState('sentence');
  const [apiKey, setApiKey] = useState(localStorage.getItem('ankify_api_key') || '');

  // Load PDF.js dynamically to keep the component self-contained
  const loadPdfJs = async () => {
    if (window.pdfjsLib) return window.pdfjsLib;
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
      script.onload = () => {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        resolve(window.pdfjsLib);
      };
      script.onerror = () => reject(new Error("Failed to load PDF processing library."));
      document.body.appendChild(script);
    });
  };

  const handleFileUpload = async (e) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile || selectedFile.type !== 'application/pdf') {
      setError("Please select a valid PDF file.");
      return;
    }

    setFile(selectedFile);
    setError(null);
    setIsExtracting(true);
    setCards([]);

    try {
      const pdfjs = await loadPdfJs();
      const arrayBuffer = await selectedFile.arrayBuffer();
      const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
      
      let extractedText = '';
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        extractedText += textContent.items.map(item => item.str).join(' ') + '\n';
      }

      if (extractedText.trim().length === 0) {
        throw new Error("No text found. This might be a scanned image without OCR.");
      }

      setPdfText(extractedText);
    } catch (err) {
      setError(err.message || "An error occurred while reading the PDF.");
    } finally {
      setIsExtracting(false);
    }
  };

  // Helper for exponential backoff on API calls
  const fetchWithRetry = async (url, options, maxRetries = 5) => {
    const delays = [1000, 2000, 4000, 8000, 16000];
    for (let i = 0; i < maxRetries; i++) {
      try {
        const response = await fetch(url, options);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        return await response.json();
      } catch (err) {
        if (i === maxRetries - 1) throw err;
        await new Promise(res => setTimeout(res, delays[i]));
      }
    }
  };

  const generateFlashcards = async () => {
    if (!pdfText) return;
    
    if (!apiKey.trim()) {
      setError("Please enter your Gemini API key. You can get one for free from Google AI Studio.");
      return;
    }

    setIsGenerating(true);
    setError(null);
    
    // Tailored instructions for an expert language learner with formatting requirements
    const systemInstruction = `You are an expert linguist, researcher, and advanced Anki flashcard creator. 
    The user is an experienced polyglot who appreciates grammar breakdowns, morphological analysis, and linguistic principles.
    
    CRITICAL FORMATTING RULES FOR THE 'BACK' OF THE CARD:
    - You MUST use beautiful, learning-conducive HTML with inline CSS.
    - Use colors to highlight important parts of speech or concepts (e.g., <span style="color: #2563eb; font-weight: bold;"> for target words, <span style="color: #059669;"> for grammatical structures/rules).
    - Use visually distinct blocks for examples (e.g., <div style="background-color: #f0fdf4; padding: 10px; border-left: 4px solid #16a34a; margin: 10px 0;">).
    - Use semantic lists (<ul>, <li>) for breakdowns.
    - Ensure the text is readable, clean, and well-spaced using <br> and paragraph tags.
    - Ensure you include periods at the end of full sentences and indicate pauses naturally if applicable.`;

    let focusPrompt = "";
    if (focusMode === 'sentence') {
      focusPrompt = "Create 'Sentence Cards' based on Krashen's input hypothesis (i+1). Front: A full target language sentence from the text with exactly one target element (word/grammar) highlighted using basic HTML. Back: The translation, pronunciation (IPA if relevant), deep grammatical breakdown, morphological analysis, and an explanation of the highlighted element utilizing linguistic principles.";
    } else if (focusMode === 'vocab') {
      focusPrompt = "Create 'Vocabulary Cards' for high-value lexis. Front: A single target word or phrase from the text. Back: The definition, its root/etymology, linguistic properties (e.g., gender, transitivity, register), and 2-3 illustrative example sentences extracted directly from the text with their translations.";
    } else {
      focusPrompt = "Create 'Research & Concept' cards for general knowledge retention (e.g., academic papers, articles). Front: A specific core concept, research question, or key terminology from the text. Back: A beautifully structured, concise explanation, key facts, and contextual significance from the text. Focus entirely on information retention and clarity rather than language learning mechanics.";
    }

    // Truncate text to avoid exceeding payload limits if the PDF is a massive book
    const textToProcess = pdfText.substring(0, 60000); 
    const userPrompt = `Create an array of Anki flashcards from the following text.\nCard Type Focus: ${focusPrompt}\n\nText:\n${textToProcess}`;

    const payload = {
      contents: [{ parts: [{ text: userPrompt }] }],
      systemInstruction: { parts: [{ text: systemInstruction }] },
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              front: { type: "STRING" },
              back: { type: "STRING" }
            },
            required: ["front", "back"]
          }
        }
      }
    };

    try {
      const data = await fetchWithRetry(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const resultText = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!resultText) throw new Error("Received an empty response from the AI.");

      const parsedCards = JSON.parse(resultText);
      setCards(parsedCards);
    } catch (err) {
      setError("Failed to generate flashcards. Please check your API key and try again.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleUpdateCard = (index, field, value) => {
    const updated = [...cards];
    updated[index][field] = value;
    setCards(updated);
  };

  const handleDeleteCard = (index) => {
    setCards(cards.filter((_, i) => i !== index));
  };

  const exportToAnki = () => {
    if (cards.length === 0) return;
    
    // Anki imports require Tab-Separated Values (TSV) where newlines and tabs inside fields are handled carefully.
    const tsvContent = cards.map(c => {
      const safeFront = c.front.replace(/\t/g, ' ').replace(/\n/g, '<br>');
      const safeBack = c.back.replace(/\t/g, ' ').replace(/\n/g, '<br>');
      return `${safeFront}\t${safeBack}`;
    }).join('\n');

    const blob = new Blob([tsvContent], { type: 'text/tab-separated-values' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ankify_${focusMode}_cards.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 p-6 md:p-12 font-sans selection:bg-blue-100">
      <div className="max-w-4xl mx-auto space-y-8">
        
        {/* Header */}
        <header className="text-center space-y-3">
          <div className="inline-flex items-center justify-center p-3 bg-blue-600 rounded-2xl shadow-lg mb-2">
            <Sparkles className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-4xl font-extrabold tracking-tight">Ankify PDF</h1>
          <p className="text-neutral-500 text-lg">Transform texts into expert-level, beautifully formatted flashcards.</p>
        </header>

        {/* API Key Input */}
        <div className="bg-white p-6 rounded-3xl shadow-sm border border-neutral-200">
          <label className="text-sm font-bold text-neutral-700 flex items-center gap-2 uppercase tracking-wide mb-2">
            Gemini API Key
          </label>
          <input 
            type="password" 
            placeholder="Paste your API key here (AIzaSy...)"
            value={apiKey}
            onChange={(e) => {
              setApiKey(e.target.value);
              localStorage.setItem('ankify_api_key', e.target.value);
            }}
            className="w-full bg-neutral-50 border border-neutral-200 text-neutral-900 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-shadow font-mono text-sm"
          />
          <p className="text-xs text-neutral-500 mt-2">
            Your key is stored safely in your browser's local storage and is never sent anywhere except directly to Google's API. Get a free key at <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">Google AI Studio</a>.
          </p>
        </div>

        {/* Error State */}
        {error && (
          <div className="bg-red-50 text-red-700 p-4 rounded-xl flex items-start gap-3 border border-red-200">
            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
            <p className="text-sm font-medium">{error}</p>
          </div>
        )}

        {/* Upload Area */}
        <div className="bg-white p-8 rounded-3xl shadow-sm border border-neutral-200 transition-all hover:shadow-md relative overflow-hidden group">
          <input 
            type="file" 
            accept="application/pdf" 
            onChange={handleFileUpload}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
            title="Drop your PDF here"
          />
          <div className="flex flex-col items-center justify-center space-y-4 text-center pointer-events-none">
            {isExtracting ? (
              <>
                <Loader2 className="w-12 h-12 text-blue-600 animate-spin" />
                <p className="text-lg font-medium text-neutral-700">Extracting text from PDF...</p>
              </>
            ) : file ? (
              <>
                <FileText className="w-12 h-12 text-blue-600" />
                <div>
                  <p className="text-lg font-medium text-neutral-900">{file.name}</p>
                  <p className="text-sm text-neutral-500">{(file.size / 1024 / 1024).toFixed(2)} MB • Click to replace</p>
                </div>
              </>
            ) : (
              <>
                <div className="w-16 h-16 bg-neutral-100 rounded-full flex items-center justify-center group-hover:bg-blue-50 transition-colors">
                  <Upload className="w-8 h-8 text-neutral-500 group-hover:text-blue-600" />
                </div>
                <div>
                  <p className="text-lg font-medium text-neutral-900">Drag & drop your PDF here</p>
                  <p className="text-sm text-neutral-500">or click to browse your files</p>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Controls & Generation */}
        {pdfText && !isExtracting && (
          <div className="bg-white p-6 rounded-3xl shadow-sm border border-neutral-200 space-y-6">
            <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
              <div className="w-full md:w-1/2 space-y-2">
                <label className="text-sm font-bold text-neutral-700 flex items-center gap-2 uppercase tracking-wide">
                  <Settings className="w-4 h-4" /> Card Style / Focus
                </label>
                <select 
                  value={focusMode} 
                  onChange={(e) => setFocusMode(e.target.value)}
                  className="w-full bg-neutral-50 border border-neutral-200 text-neutral-900 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-shadow font-medium"
                >
                  <option value="sentence">Sentence Cards (Research-Backed Context)</option>
                  <option value="vocab">Vocabulary Cards (Targeted Lexis)</option>
                  <option value="research">Research / General Knowledge (Non-Language)</option>
                </select>
              </div>
              
              <button 
                onClick={generateFlashcards}
                disabled={isGenerating}
                className="w-full md:w-auto mt-4 md:mt-0 bg-neutral-900 hover:bg-neutral-800 text-white font-medium px-8 py-3.5 rounded-xl transition-all disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-md hover:shadow-lg"
              >
                {isGenerating ? (
                  <><Loader2 className="w-5 h-5 animate-spin" /> Synthesizing Cards...</>
                ) : (
                  <><Sparkles className="w-5 h-5" /> Generate Cards</>
                )}
              </button>
            </div>
            
            <p className="text-xs text-neutral-400">
              Loaded {pdfText.length.toLocaleString()} characters. The AI will apply rich, color-coded HTML formatting based on your selected card style.
            </p>
          </div>
        )}

        {/* Results / Card Editor */}
        {cards.length > 0 && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-blue-50 p-6 rounded-2xl border border-blue-100">
              <div>
                <h2 className="text-xl font-bold text-blue-900">Successfully created {cards.length} cards</h2>
                <p className="text-sm text-blue-700 mt-1">Review your cards below. The rich HTML styling will render perfectly in Anki.</p>
              </div>
              <button 
                onClick={exportToAnki}
                className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-xl font-medium flex items-center gap-2 transition-colors shadow-sm w-full sm:w-auto justify-center"
              >
                <Download className="w-5 h-5" /> Export to Anki
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {cards.map((card, idx) => (
                <div key={idx} className="bg-white p-5 rounded-2xl shadow-sm border border-neutral-200 flex flex-col hover:shadow-md transition-shadow relative group">
                  <div className="space-y-4 flex-grow">
                    <div>
                      <label className="text-xs font-bold text-neutral-400 uppercase tracking-wider mb-1 block">Front</label>
                      <textarea 
                        value={card.front} 
                        onChange={(e) => handleUpdateCard(idx, 'front', e.target.value)}
                        className="w-full bg-neutral-50 p-3 rounded-xl border border-neutral-200 outline-none focus:ring-2 focus:ring-blue-500 resize-none min-h-[80px]"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-bold text-neutral-400 uppercase tracking-wider mb-1 block">Back (Styled HTML)</label>
                      <textarea 
                        value={card.back} 
                        onChange={(e) => handleUpdateCard(idx, 'back', e.target.value)}
                        className="w-full bg-neutral-50 p-3 rounded-xl border border-neutral-200 outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm resize-none min-h-[160px]"
                      />
                    </div>
                  </div>
                  
                  <div className="mt-4 pt-4 border-t border-neutral-100 flex justify-end">
                    <button 
                      onClick={() => handleDeleteCard(idx)}
                      className="text-red-500 hover:text-red-700 p-2 rounded-lg hover:bg-red-50 transition-colors flex items-center gap-2 text-sm font-medium"
                    >
                      <Trash2 className="w-4 h-4" /> Discard
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Import Instructions */}
            <div className="bg-white p-6 rounded-2xl border border-neutral-200 text-sm text-neutral-600 mt-8">
              <h3 className="font-bold text-neutral-900 text-base mb-2">How to import into Anki with styles:</h3>
              <ol className="list-decimal pl-5 space-y-1">
                <li>Click <strong>Export to Anki</strong> to download the `.txt` file.</li>
                <li>Open the Anki desktop application.</li>
                <li>Go to <strong>File &gt; Import</strong> and select your downloaded `.txt` file.</li>
                <li>Ensure <strong>Fields separated by: Tab</strong> is selected in the import dialog.</li>
                <li><strong>Crucial step:</strong> Check the "Allow HTML in fields" option so your new beautiful formatting renders properly!</li>
              </ol>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}