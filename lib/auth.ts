import { SessionUser } from '@/types';

export function validateCredentials(email: string, password: string): SessionUser | null {
   const allowedEmail = process.env.ADMIN_EMAIL ?? "admin@norug.es";
   const allowedPassword = process.env.ADMIN_PASSWORD ?? "norug-demo";
   if (!email || typeof email !== 'string' || !password || typeof password !== 'string') return null;
   if (email.trim().toLowerCase() !== allowedEmail.toLowerCase() || password !== allowedPassword) return null;
   return { email: allowedEmail, name: "Moisés Ramos" };
}