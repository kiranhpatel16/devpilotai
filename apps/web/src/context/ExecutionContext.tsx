import { createContext, useContext, useState, type ReactNode } from 'react';

interface ExecutionContextValue {
  branchName: string | null;
  setBranchName: (branch: string | null) => void;
  projectName: string | null;
  setProjectName: (name: string | null) => void;
}

const ExecutionContext = createContext<ExecutionContextValue>({
  branchName: null,
  setBranchName: () => {},
  projectName: null,
  setProjectName: () => {},
});

export function ExecutionProvider({ children }: { children: ReactNode }) {
  const [branchName, setBranchName] = useState<string | null>(null);
  const [projectName, setProjectName] = useState<string | null>(null);

  return (
    <ExecutionContext.Provider value={{ branchName, setBranchName, projectName, setProjectName }}>
      {children}
    </ExecutionContext.Provider>
  );
}

export function useExecution() {
  return useContext(ExecutionContext);
}
