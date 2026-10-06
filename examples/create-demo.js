/* Generate the editable UTF-8 demonstration supplied with Paint 10 Plus. */
const fs = require('node:fs');
const path = require('node:path');
const style = {stroke:'#0078D7',fill:'none',strokeWidth:2,dash:'solid',opacity:1,startArrow:'none',endArrow:'none',fontFamily:'Microsoft YaHei',fontSize:26,bold:false,textDirection:'horizontal',align:'left',lineHeight:1.4,brush:'pencil'};
const objects=[];
function shape(type,x,y,w,h,paint={},extra={}) {
  const object={id:'demo-'+(objects.length+1),name:type,type,x,y,w,h,rotation:0,visible:true,locked:false,style:{...style,...paint},...extra};
  objects.push(object);return object;
}
function text(value,x,y,size=24,color='#173B5C',extra={}) {
  return shape('text',x,y,650,size*1.6,{stroke:'none',fill:color,fontSize:size,...extra},{name:value,text:value});
}
text('熟悉的画图，更精确的表达',52,35,32,'#173B5C',{bold:true});
text('Windows 10 经典功能区 · 精准颜色 · 可编辑图形与中文竖排',54,94,16,'#6D7E8B');
shape('roundrect',54,165,220,132,{stroke:'#0078D7',fill:'#E8F3FF'});
text('01  精准绘制',75,185,19,'#0078D7',{bold:true});
text('HEX / RGB 指定颜色',75,223,15,'#315E80');
text('细到 0.1 px 的线条',75,251,15,'#315E80');
shape('arrowright',302,211,100,37,{stroke:'#0078D7',fill:'#B4DDFC',strokeWidth:1.5});
shape('roundrect',432,165,220,132,{stroke:'#21A179',fill:'#EAF7F0'});
text('02  丰富形状',453,185,19,'#168C68',{bold:true});
text('箭头、框、圈与可调弧线',453,223,15,'#39745F');
text('1 px 橡皮处理细小边角',453,251,15,'#39745F');
shape('ellipse',710,185,76,76,{stroke:'#DC8A30',fill:'#FFF3DF'});
shape('star4',729,204,38,38,{stroke:'#DC8A30',fill:'#F2BD72',strokeWidth:1});
shape('curve',150,316,398,110,{stroke:'#0078D7',strokeWidth:2,dash:'dotted',endArrow:'triangle'},{points:[{x:398,y:0},{x:198,y:110},{x:0,y:0}]});
text('点状曲线 · 拖动控制点自由调整弧度',174,386,16,'#6D7E8B');
shape('frame',54,445,732,39,{stroke:'#99B3C7',strokeWidth:1,dash:'dashed'});
text('双击文字可编辑；选中形状后打开“增强”调整精确属性',71,452,14,'#46647B');
shape('text',822,165,72,208,{stroke:'none',fill:'#0078D7',fontSize:22,textDirection:'vertical',lineHeight:1.6},{text:'精准色彩\n竖排文字',name:'中文竖排'});
const document={name:'Win10画图增强 · 功能示例',width:900,height:520,background:'#FFFFFF',objects};
fs.writeFileSync(path.join(__dirname,'增强功能示例.graphite'),JSON.stringify({format:'graphite-studio',version:1,document},null,2),'utf8');
