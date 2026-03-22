const PDFJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const PDFJS_WORKER_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

let loadingPromise: Promise<any> | null = null;

export const loadPDFJS = (): Promise<any> => {
  if ((window as any).pdfjsLib) return Promise.resolve((window as any).pdfjsLib);
  if (loadingPromise) return loadingPromise;
  loadingPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = PDFJS_URL;
    script.onload = () => {
      (window as any).pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
      resolve((window as any).pdfjsLib);
    };
    script.onerror = (err) => { loadingPromise = null; reject(err); };
    document.head.appendChild(script);
  });
  return loadingPromise;
};

export const extractTextFromPDF = async (file: File): Promise<string> => {
  const pdfjs = await loadPDFJS();
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
  const pageNumbers = Array.from({ length: pdf.numPages }, (_, i) => i + 1);
  const pages = await Promise.all(pageNumbers.map((n) => pdf.getPage(n)));
  const textContents = await Promise.all(pages.map((p: any) => p.getTextContent()));
  return textContents
    .map((tc: any) => tc.items.map((item: any) => item.str).join(' '))
    .join('\n');
};
