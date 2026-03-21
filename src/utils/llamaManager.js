{\rtf1\ansi\ansicpg1252\cocoartf2820
\cocoatextscaling0\cocoaplatform0{\fonttbl\f0\fnil\fcharset0 Menlo-Regular;}
{\colortbl;\red255\green255\blue255;\red183\green111\blue247;\red23\green24\blue24;}
{\*\expandedcolortbl;;\cssrgb\c77255\c54118\c97647;\cssrgb\c11765\c12157\c12549;}
\margl1440\margr1440\vieww17720\viewh13340\viewkind0
\deftab720
\pard\pardeftab720\partightenfactor0

\f0\fs28 \cf2 \cb3 \expnd0\expndtw0\kerning0
import \{ CreateMLCEngine \} from "@mlc-ai/web-llm";\
\
export const LlamaManager = \{\
  // We use a pre-configured Llama 3 8B model optimized for WebGPU\
  selectedModel: "Llama-3-8B-Instruct-q4f16_1-MLC",\
\
  async loadNativeAI(onProgress) \{\
    try \{\
      console.log("Initializing WebLLM Engine...");\
      \
      const engine = await CreateMLCEngine(\
        this.selectedModel,\
        \{\
          initProgressCallback: (report) => \{\
            // report.progress is a decimal between 0 and 1\
            onProgress(Math.round(report.progress * 100));\
            console.log(report.text); // Helpful for debugging in the console\
          \}\
        \}\
      );\
      \
      console.log("WebLLM Engine successfully loaded!");\
      return engine;\
    \} catch (err) \{\
      console.error("Local AI failed to load:", err);\
      throw err;\
    \}\
  \}\
\};}