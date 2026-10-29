/** "512 B", "240 KB" or "3.4 MB". Under 1 KB stays in bytes, under 1 MB rounds to whole KB. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = Math.round(bytes / 1024);
  if (kb < 1024) return `${kb} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
