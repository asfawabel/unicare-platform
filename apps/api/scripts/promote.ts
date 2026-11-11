import 'dotenv/config';
import {PrismaClient} from '@prisma/client';
const email=process.argv[2]?.trim().toLowerCase();
if(!email){console.error('Usage: npm run admin:promote -w @unicare/api -- admin@example.org');process.exit(1);}
const db=new PrismaClient();
try {const user=await db.user.update({where:{email},data:{role:'ADMIN'}});console.log('Promoted',user.email,'to ADMIN');}
catch(e){console.error('Account not found or database unavailable');process.exitCode=1;}
finally{await db.$disconnect();}
