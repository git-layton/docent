// ─── Native PDF Parser (Dynamic Loader) ──────────────────────────────────────

export const loadPDFJS = async (): Promise<any> => {
  if ((window as any).pdfjsLib) return (window as any).pdfjsLib;
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    script.onload = () => {
      (window as any).pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      resolve((window as any).pdfjsLib);
    };
    script.onerror = reject;
    document.head.appendChild(script);
  });
};

export const extractTextFromPDF = async (file: File) => {
    const pdfjs = await loadPDFJS();
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
    let fullText = '';
    for (let i = 1; i <= pdf.numPages; i++) {
       const page = await pdf.getPage(i);
       const textContent = await page.getTextContent();
       fullText += textContent.items.map((item: any) => item.str).join(' ') + '\n';
    }
    return fullText;
};
