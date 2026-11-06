type Meeting = {version:number; schedule_version?:number; starts_at:string; cancelled:boolean; title:string; place:string; venue_url?:string; description:string};
export function shouldNotify(job:{kind:string;meeting_version:number},meeting:Meeting,active:boolean,attendance:{response:string;schedule_version?:number}|null,now=Date.now()) {
 if(!active||meeting.version!==job.meeting_version)return false;
 if(meeting.cancelled)return job.kind==='cancelled';
 if(job.kind==='cancelled'||Date.parse(meeting.starts_at)<=now)return false;
 return !(['24h','1h'].includes(job.kind)&&attendance?.response==='no'&&attendance.schedule_version===(meeting.schedule_version||1));
}
export function meetingNotificationText(kind:string,meeting:Meeting) {
 const prefix:Record<string,string>={new:'Приглашение на встречу клуба',changed:'Встреча клуба изменилась',cancelled:'Встреча клуба отменена','24h':'Завтра встречаемся в книжном клубе','1h':'Встреча клуба через час'};
 return `${prefix[kind]||'Встреча клуба'}: ${meeting.title}\n${new Date(meeting.starts_at).toLocaleString('ru-RU',{timeZone:'Europe/Moscow',day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'})} (МСК)\n${meeting.place}${meeting.venue_url?'\n'+meeting.venue_url:''}\n${meeting.description}${kind==='new'||kind==='changed'?'\n\nСможете прийти? Ответьте в приложении.':''}`.slice(0,4000);
}
