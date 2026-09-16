// アプリのブランドマーク。左の3本のバーが部品行、右の2列のドットがPL列を表し、
// 1列目を選択中のPLとして強調したマトリックスBOMの図案。
// public/ のアイコン・Faviconと同じデザインで、scripts/generate-icons.py が元データ。
export default function BrandMark({className='logo'}:{className?:string}){
return <svg className={className} viewBox="0 0 64 64" role="img" aria-label="Matrix Parts List">
<defs>
<linearGradient id="mpl-bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#6a74f4"/><stop offset=".52" stopColor="#5a66e8"/><stop offset="1" stopColor="#8a54d6"/></linearGradient>
<linearGradient id="mpl-sheen" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff" stopOpacity=".22"/><stop offset=".62" stopColor="#fff" stopOpacity="0"/></linearGradient>
</defs>
<rect width="64" height="64" rx="15" fill="url(#mpl-bg)"/>
<rect width="64" height="64" rx="15" fill="url(#mpl-sheen)"/>
<rect x=".5" y=".5" width="63" height="63" rx="14.5" fill="none" stroke="#fff" strokeOpacity=".16"/>
<rect x="10.5" y="15.5" width="14" height="5" rx="2.5" fill="#fff" fillOpacity=".55"/>
<rect x="10.5" y="29.5" width="14" height="5" rx="2.5" fill="#fff" fillOpacity=".55"/>
<rect x="10.5" y="43.5" width="14" height="5" rx="2.5" fill="#fff" fillOpacity=".55"/>
<rect x="28.2" y="8.4" width="15.6" height="47.2" rx="7.8" fill="#fff" fillOpacity=".2"/>
<circle cx="36" cy="18" r="5.4" fill="#fff"/>
<circle cx="36" cy="32" r="5.4" fill="#fff"/>
<circle cx="36" cy="46" r="5.4" fill="#fff"/>
<circle cx="50.5" cy="18" r="5.4" fill="#fff" fillOpacity=".45"/>
<circle cx="50.5" cy="32" r="5.4" fill="#fff" fillOpacity=".92"/>
<circle cx="50.5" cy="46" r="5.4" fill="#fff" fillOpacity=".45"/>
</svg>;
}
