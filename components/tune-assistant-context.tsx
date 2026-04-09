'use client';

import { createContext, useContext } from 'react';
import { EndpointDefinition } from '@/lib/types';

type TuneAssistantContextValue = {
  endpoints: EndpointDefinition[];
  selectedIds: string[];
  tunedEndpointIds: string[];
  pickerOpen: boolean;
  setPickerOpen: (open: boolean) => void;
};

const TuneAssistantContext = createContext<TuneAssistantContextValue | null>(null);

export const TuneAssistantProvider = TuneAssistantContext.Provider;

export function useTuneAssistantContext() {
  const value = useContext(TuneAssistantContext);
  if (!value) {
    throw new Error('useTuneAssistantContext must be used within TuneAssistantProvider');
  }

  return value;
}
