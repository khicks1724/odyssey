import { randomUUID } from 'node:crypto';

export const DEFAULT_THESIS_EXAMPLE_PATH = 'OdysseyExample.tex';
export const DEFAULT_THESIS_EXAMPLE_DRAFT = String.raw`\documentclass{article}

\title{Odyssey: An AI-Enabled Task Management Software}
\author{Kyle Hicks}
\date{\today}

\begin{document}

\maketitle

\section{Problem Statement}
Modern task management tools often lack intelligent prioritization, contextual awareness, and automation capabilities. Users must manually organize, track, and update tasks, which can lead to inefficiencies and missed deadlines. This project investigates whether integrating AI-driven decision support and automation into a task management platform can improve productivity, organization, and user experience.

\section{Research Objective}
The objective of this project is to design and implement an AI-enabled task management system, Odyssey, that enhances traditional task tracking with intelligent prioritization, automated scheduling, and contextual insights.

\section{Research Questions}
\begin{enumerate}
\item Can AI models effectively prioritize tasks based on context, deadlines, and user behavior?
\item What tradeoffs exist between system complexity, responsiveness, and usability?
\item How can automation be integrated without reducing user control or transparency?
\end{enumerate}

\section{Methodology}
This project will be executed in four primary phases.

\subsection{Background Review}
A review will be conducted on existing task management systems, productivity tools, and AI techniques for scheduling, recommendation systems, and natural language processing.

\subsection{System Design}
The architecture of Odyssey will be defined, including frontend interface, backend services, and AI integration components. Emphasis will be placed on scalability and modularity.

\subsection{Model Development}
Lightweight AI models will be developed to support task prioritization, natural language task input, and intelligent scheduling recommendations.

\subsection{Implementation and Integration}
The system will be implemented using modern development frameworks. AI components will be integrated into the workflow to provide real-time assistance and automation.

\subsection{Evaluation}
The system will be evaluated based on usability, task completion efficiency, recommendation accuracy, and system performance.

\section{Expected Contribution}
This project is expected to deliver a functional prototype of an AI-enabled task management platform that demonstrates how intelligent automation can enhance productivity tools. It will also provide insights into the tradeoffs between AI capability and user experience in real-world applications.

\section{Schedule}
\begin{enumerate}
\item Literature review
\item System architecture design
\item AI model development
\item Software implementation
\item System integration
\item Testing and evaluation
\item Documentation and final report
\end{enumerate}

\end{document}
`;

export function isKyleHicksDisplayName(displayName: string | null | undefined) {
  return (displayName ?? '').trim().toLowerCase() === 'kyle hicks';
}

function buildStats(draft: string) {
  return {
    lineCount: draft.split('\n').length,
    wordCount: draft.trim().length > 0 ? draft.trim().split(/\s+/).length : 0,
  };
}

export function createDefaultThesisDocumentSeed() {
  const fileId = randomUUID();
  return {
    draft: DEFAULT_THESIS_EXAMPLE_DRAFT,
    snapshot: {
      draft: DEFAULT_THESIS_EXAMPLE_DRAFT,
      ...buildStats(DEFAULT_THESIS_EXAMPLE_DRAFT),
      previewStatus: 'idle',
      renderError: null,
      previewText: '',
      editorState: null,
      workspace: {
        files: [
          {
            id: fileId,
            path: DEFAULT_THESIS_EXAMPLE_PATH,
            content: DEFAULT_THESIS_EXAMPLE_DRAFT,
          },
        ],
        folders: [],
        activeFileId: fileId,
      },
      activeFileId: fileId,
      activeFilePath: DEFAULT_THESIS_EXAMPLE_PATH,
      updatedAt: Date.now(),
    },
  };
}
