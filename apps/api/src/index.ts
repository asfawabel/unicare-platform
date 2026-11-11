import 'dotenv/config';
import express, {type Request, type Response, type NextFunction} from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import {z} from 'zod';
import {PrismaClient} from '@prisma/client';
const db = new PrismaClient();
const app = express();
const origins = (process.env.CORS_ORIGINS||'http://localhost:5173,http://localhost:5174').split(',').map(s=>s.trim());
app.use(helmet());
app.use(cors({origin:origins}));
app.use(express.json({limit:'32kb'}));
app.use('/auth',rateLimit({windowMs:15*60*1000,limit:30,standardHeaders:'draft-7',legacyHeaders:false}));
const secret=process.env.JWT_SECRET;
if (!secret || secret.length < 32) throw new Error('Set JWT_SECRET to a random string of at least 32 characters');
const sign=(id:string)=>jwt.sign({sub:id},secret,{expiresIn:'7d'});
function parse<T>(schema:z.ZodType<T>,value:unknown):T {return schema.parse(value);}
function safe(fn:(req:Request,res:Response)=>Promise<unknown>){return (req:Request,res:Response,next:NextFunction)=>{Promise.resolve(fn(req,res)).catch(next);};}
type AuthRequest=Request & {userId?:string};
function auth(req:AuthRequest,res:Response,next:NextFunction){try{const header=req.headers.authorization;if(!header?.startsWith('Bearer ')) {res.status(401).json({error:'Sign in first'});return;}const payload=jwt.verify(header.slice(7),secret) as jwt.JwtPayload;if(typeof payload.sub!=='string')throw Error();req.userId=payload.sub;next();}catch{res.status(401).json({error:'Invalid or expired session'});}}
app.get('/health',(_req,res)=>res.json({status:'ok',service:'unicare-api'}));
app.get('/courses',safe(async(_req,res)=>{res.json(await db.course.findMany({where:{published:true},include:{_count:{select:{lessons:true}}},orderBy:{createdAt:'asc'}}));}));
app.get('/courses/:slug',safe(async(req,res)=>{const course=await db.course.findUnique({where:{slug:req.params.slug},include:{lessons:{orderBy:{position:'asc'}}}});if(!course?.published){res.status(404).json({error:'Course not found'});return;}res.json(course);}));
const credentials=z.object({email:z.string().trim().email().max(254),password:z.string().min(8).max(128)});
app.post('/auth/register',safe(async(req,res)=>{const input=parse(credentials.extend({name:z.string().trim().min(2).max(90)}),req.body);const email=input.email.toLowerCase();if(await db.user.findUnique({where:{email}})){res.status(409).json({error:'Email already registered'});return;}const user=await db.user.create({data:{name:input.name,email,passwordHash:await bcrypt.hash(input.password,12)}});res.status(201).json({token:sign(user.id),user:{id:user.id,name:user.name,email:user.email,role:user.role}});}));
app.post('/auth/login',safe(async(req,res)=>{const input=parse(credentials,req.body);const user=await db.user.findUnique({where:{email:input.email.toLowerCase()}});if(!user||!await bcrypt.compare(input.password,user.passwordHash)){res.status(401).json({error:'Incorrect email or password'});return;}res.json({token:sign(user.id),user:{id:user.id,name:user.name,email:user.email,role:user.role}});}));
app.get('/me',auth,safe(async(req:AuthRequest,res)=>{const user=await db.user.findUnique({where:{id:req.userId},select:{id:true,name:true,email:true,role:true}});if(!user){res.status(401).json({error:'User not found'});return;}res.json(user);}));
app.get('/me/courses',auth,safe(async(req:AuthRequest,res)=>{const rows=await db.enrollment.findMany({where:{userId:req.userId},include:{course:{include:{lessons:{select:{id:true}}}}},orderBy:{createdAt:'desc'}});const completions=await db.lessonProgress.findMany({where:{userId:req.userId},select:{lessonId:true}});const completed=new Set(completions.map(x=>x.lessonId));res.json(rows.map(({course})=>({...course,completed:course.lessons.filter(l=>completed.has(l.id)).length,total:course.lessons.length})));}));
app.post('/courses/:slug/enroll',auth,safe(async(req:AuthRequest,res)=>{const course=await db.course.findUnique({where:{slug:req.params.slug}});if(!course?.published){res.status(404).json({error:'Course not found'});return;}await db.enrollment.upsert({where:{userId_courseId:{userId:req.userId!,courseId:course.id}},create:{userId:req.userId!,courseId:course.id},update:{}});res.json({success:true});}));
app.get('/courses/:slug/progress',auth,safe(async(req:AuthRequest,res)=>{const course=await db.course.findUnique({where:{slug:req.params.slug}});if(!course){res.status(404).json({error:'Course not found'});return;}const progress=await db.lessonProgress.findMany({where:{userId:req.userId,lesson:{courseId:course.id}},select:{lessonId:true}});res.json({completedLessonIds:progress.map(x=>x.lessonId)});}));
app.post('/lessons/:id/complete',auth,safe(async(req:AuthRequest,res)=>{const lesson=await db.lesson.findUnique({where:{id:req.params.id}});if(!lesson){res.status(404).json({error:'Lesson not found'});return;}const enrolled=await db.enrollment.findUnique({where:{userId_courseId:{userId:req.userId!,courseId:lesson.courseId}}});if(!enrolled){res.status(403).json({error:'Enroll in the course first'});return;}await db.lessonProgress.upsert({where:{userId_lessonId:{userId:req.userId!,lessonId:lesson.id}},create:{userId:req.userId!,lessonId:lesson.id},update:{}});res.json({success:true});}));
app.use((err:unknown,_req:Request,res:Response,_next:NextFunction)=>{if(err instanceof z.ZodError){res.status(400).json({error:err.issues[0]?.message??'Invalid input'});return;}if(typeof err==='object'&&err!==null&&'code'in err&&err.code==='P2002'){res.status(409).json({error:'Already exists'});return;}console.error(err);res.status(500).json({error:'Unexpected server error'});});
const port=Number(process.env.PORT||4000);
app.listen(port,()=>console.log(`UniCare API listening on http://localhost:${port}`));
