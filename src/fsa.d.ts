// Tipos do File System Access que faltam na lib padrão do TypeScript.
interface FileSystemHandlePermissionDescriptor {
  mode?: 'read' | 'readwrite';
}

interface FileSystemHandle {
  queryPermission?: (d?: FileSystemHandlePermissionDescriptor) => Promise<PermissionState>;
  requestPermission?: (d?: FileSystemHandlePermissionDescriptor) => Promise<PermissionState>;
}

interface Window {
  showDirectoryPicker?: (opts?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
}
