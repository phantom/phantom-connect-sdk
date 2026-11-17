export type DeviceCodeAuthDisplayOptions = {
  openBrowser?: boolean;
  onPrompt?: (message: string) => void | Promise<void>;
};
