export type Part={balloon:string;partNo:string;version:string;quantity:string;unit:string;name:string;material:string;changeStatus:string;additionalInfo:string;unavailable:string;unitMass:string;specification:string};
export type PartsList={id:string;fileName:string;plNo:string;plName:string;plVersion:string;note?:string;machineId:string;modeId:string;parts:Part[];visible:boolean;importedAt:string};
export type AppData={revision:number;updatedAt:string;lists:PartsList[]};
export const emptyData:AppData={revision:0,updatedAt:new Date(0).toISOString(),lists:[]};
