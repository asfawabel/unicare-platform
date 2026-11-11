import 'dotenv/config';
import express, {type Request, type Response, type NextFunction} from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import {z} from 'zod';
import {PrismaClient} from '@prisma/client';
import multer from 'multer';
import {mkdir, open, rename, rm, stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
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
// Uploaded videos are kept outside the public web root and never served by express.static.
const storageDir=path.resolve(process.env.UPLOAD_DIR||'./uploads');
const MAX_VIDEO_BYTES=Number(process.env.MAX_VIDEO_BYTES||209715200);
const disk=multer.diskStorage({
 destination:(_req,_file,cb)=>cb(null,storageDir),
 filename:(_req,_file,cb)=>cb(null,randomUUID()+'.upload')
});
const upload=multer({storage:disk,limits:{fileSize:MAX_VIDEO_BYTES,files:1},
 fileFilter:(_req,file,cb)=>cb(null,['video/mp4','video/webm'].includes(file.mimetype))
});
async function allowedVideoSignature(filename:string,mime:string){
 const f=await open(filename,'r');
 try {const header=Buffer.alloc(16);const {bytesRead}=await f.read(header,0,16,0);
  if(mime==='video/mp4')return bytesRead>=12&&header.toString('ascii',4,8)==='ftyp';
  return bytesRead>=4&&header.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3]));
 } finally {await f.close();}
}
async function requireStaff(req:AuthRequest,res:Response,next:NextFunction){
 const user=await db.user.findUnique({where:{id:req.userId},select:{role:true}});
 if(!user||!['ADMIN','TEACHER'].includes(user.role)){res.status(403).json({error:'Teacher or administrator access required'});return;}
 next();
}
const staff=[auth,(req:AuthRequest,res:Response,next:NextFunction)=>{void requireStaff(req,res,next).catch(next)}] as const;
const courseInput=z.object({title:z.string().trim().min(3).max(140),slug:z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(100),description:z.string().trim().min(10).max(1200),category:z.string().trim().min(2).max(80),level:z.string().trim().min(2).max(60).default('Beginner'),duration:z.string().trim().min(2).max(50).default('Self-paced'),published:z.boolean().default(false)});
app.get('/admin/courses',...staff,safe(async(_req,res)=>res.json(await db.course.findMany({include:{lessons:{orderBy:{position:'asc'}}},orderBy:{createdAt:'desc'}}))));
app.post('/admin/courses',...staff,safe(async(req,res)=>{const body=parse(courseInput,req.body);const course=await db.course.create({data:{...body,accent:'teal'}});res.status(201).json(course);}));
app.patch('/admin/courses/:id',...staff,safe(async(req,res)=>{
 const body=parse(courseInput.partial(),req.body);
 const course=await db.course.update({where:{id:req.params.id},data:body});res.json(course);
}));
const lessonInput=z.object({title:z.string().trim().min(3).max(160),content:z.string().trim().max(20000).default('')});
app.post('/admin/courses/:id/lessons',...staff,safe(async(req,res)=>{
 const body=parse(lessonInput,req.body);
 const course=await db.course.findUnique({where:{id:req.params.id},select:{id:true}});
 if(!course){res.status(404).json({error:'Course not found'});return;}
 const last=await db.lesson.aggregate({where:{courseId:course.id},_max:{position:true}});
 const lesson=await db.lesson.create({data:{...body,courseId:course.id,position:(last._max.position??0)+1}});
 res.status(201).json(lesson);
}));
// Multer writes to a private persistent directory; validation also checks the file signature.
app.post('/admin/lessons/:id/video',...staff,(req,res,next)=>{
 void mkdir(storageDir,{recursive:true}).then(()=>upload.single('video')(req,res,next)).catch(next);
},safe(async(req:AuthRequest,res)=>{
 if(!req.file){res.status(400).json({error:'Choose an MP4 or WebM video (max 200 MB by default)'});return;}
 const uploaded=req.file.path;
 try {
  const lesson=await db.lesson.findUnique({where:{id:req.params.id}});
  if(!lesson){res.status(404).json({error:'Lesson not found'});return;}
  if(!await allowedVideoSignature(uploaded,req.file.mimetype)){res.status(400).json({error:'Invalid video file format'});return;}
  const savedName=randomUUID()+(req.file.mimetype==='video/mp4'?'.mp4':'.webm');
  await rename(uploaded,path.join(storageDir,savedName));
  try {
   await db.lesson.update({where:{id:lesson.id},data:{videoPath:savedName,videoMime:req.file.mimetype,videoOriginalName:req.file.originalname.slice(0,255)}});
  } catch(e){await rm(path.join(storageDir,savedName),{force:true});throw e;}
  if(lesson.videoPath)await rm(path.join(storageDir,lesson.videoPath),{force:true}).catch(()=>{});
  res.status(201).json({success:true,filename:req.file.originalname});
 } finally {await rm(uploaded,{force:true}).catch(()=>{});}
}));
// Authenticated students must be enrolled; teachers/admins can preview.
app.post('/lessons/:id/playback',auth,safe(async(req:AuthRequest,res)=>{
 const lesson=await db.lesson.findUnique({where:{id:req.params.id},include:{course:{select:{published:true}}}});
 if(!lesson?.videoPath){res.status(404).json({error:'No video is available for this lesson'});return;}
 const member=await db.user.findUnique({where:{id:req.userId},select:{role:true}});
 const privileged=member?.role==='ADMIN'||member?.role==='TEACHER';
 if(!privileged){
  const enrolled=await db.enrollment.findUnique({where:{userId_courseId:{userId:req.userId!,courseId:lesson.courseId}}});
  if(!lesson.course.published||!enrolled){res.status(403).json({error:'Enroll to watch this video'});return;}
 }
 const ticket=jwt.sign({lessonId:lesson.id,kind:'video'},secret,{expiresIn:'2h'});
 const publicApiUrl=process.env.PUBLIC_API_URL;
 const base=publicApiUrl?.replace(/\/$/,'')||`${req.protocol}://${req.get('host')}`;
 res.json({url:`${base}/media/${lesson.id}?ticket=${encodeURIComponent(ticket)}`});
}));
app.get('/media/:id',safe(async(req,res)=>{
 let payload:jwt.JwtPayload;
 try {payload=jwt.verify(String(req.query.ticket||''),secret) as jwt.JwtPayload;}
 catch {res.status(401).json({error:'Video link expired'});return;}
 if(payload.kind!=='video'||payload.lessonId!==req.params.id){res.status(403).json({error:'Invalid video link'});return;}
 const lesson=await db.lesson.findUnique({where:{id:req.params.id},select:{videoPath:true,videoMime:true}});
 if(!lesson?.videoPath||!lesson.videoMime){res.status(404).end();return;}
 const filePath=path.join(storageDir,path.basename(lesson.videoPath));
 let info;try{info=await stat(filePath);}catch{res.status(404).json({error:'Video storage unavailable'});return;}
 const range=req.headers.range;
 const common={'Content-Type':lesson.videoMime,'Accept-Ranges':'bytes','Cache-Control':'private, no-store','Cross-Origin-Resource-Policy':'cross-origin','X-Content-Type-Options':'nosniff'};
 if(!range){res.writeHead(200,{...common,'Content-Length':info.size});createReadStream(filePath).pipe(res);return;}
 const match=/^bytes=(\d*)-(\d*)$/.exec(range);
 if(!match){res.status(416).set('Content-Range',`bytes */${info.size}`).end();return;}
 let start=match[1]?Number(match[1]):0;let end=match[2]?Number(match[2]):info.size-1;
 if(!match[1]&&match[2]){const suffix=Number(match[2]);start=Math.max(0,info.size-suffix);end=info.size-1;}
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end>=info.size||start>end){res.status(416).set('Content-Range',`bytes */${info.size}`).end();return;}
 res.writeHead(206,{...common,'Content-Range':`bytes ${start}-${end}/${info.size}`,'Content-Length':end-start+1});
 createReadStream(filePath,{start,end}).pipe(res);
}));
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
app.use((err:unknown,_req:Request,res:Response,_next:NextFunction)=>{if(err instanceof multer.MulterError){res.status(400).json({error:err.code==='LIMIT_FILE_SIZE'?'Video exceeds the upload size limit':err.message});return;}if(err instanceof z.ZodError){res.status(400).json({error:err.issues[0]?.message??'Invalid input'});return;}if(typeof err==='object'&&err!==null&&'code'in err&&err.code==='P2002'){res.status(409).json({error:'Already exists'});return;}console.error(err);res.status(500).json({error:'Unexpected server error'});});
const port=Number(process.env.PORT||4000);
app.listen(port,()=>console.log(`UniCare API listening on http://localhost:${port}`));
