import { Client, Account, OAuthProvider } from 'appwrite';

export const env = {
  endpoint: import.meta.env.VITE_APPWRITE_ENDPOINT,
  projectId: import.meta.env.VITE_APPWRITE_PROJECT_ID,
  databaseId: import.meta.env.VITE_APPWRITE_DATABASE_ID || 'modelagem3d',
  apiUrl: (import.meta.env.VITE_API_URL || '').replace(/\/$/, ''),
};

export const client = new Client().setEndpoint(env.endpoint).setProject(env.projectId);
export const account = new Account(client);
export { OAuthProvider };

// ---- Canais Realtime (o Appwrite só entrega eventos de documentos que o usuário pode ler)
export const channels = {
  profile: (uid) => `databases.${env.databaseId}.collections.profiles.documents.${uid}`,
  projects: () => `databases.${env.databaseId}.collections.projects.documents`,
  transaction: (id) => `databases.${env.databaseId}.collections.transactions.documents.${id}`,
};
