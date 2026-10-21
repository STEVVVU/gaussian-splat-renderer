export function decodeHeader(buffer: ArrayBuffer): [number, Record<string,string>, DataView] {
    if (buffer.byteLength > 256*1024*1024) throw new Error('PLY exceeds the 256 MiB local scene limit');
    const bytes=new Uint8Array(buffer);
    const text=new TextDecoder().decode(bytes.subarray(0,Math.min(bytes.length,65536)));
    const end=/end_header\r?\n/.exec(text);
    if (!end || !text.startsWith('ply\n') && !text.startsWith('ply\r\n')) throw new Error('Missing PLY header');
    const lines=text.slice(0,end.index).split(/\r?\n/);
    if (!lines.includes('format binary_little_endian 1.0')) throw new Error('Only binary little endian PLY is supported');
    let count=0; let inVertex=false; let stride=0;
    const properties: Record<string,string>={};
    for (const line of lines) {
        if (line.startsWith('element ')) {
            const match=/^element vertex (\d+)$/.exec(line);
            inVertex=!!match;
            if (match) count=Number(match[1]);
            else if (count===0) throw new Error('Vertex must be the first PLY element');
        } else if (line.startsWith('property ') && inVertex) {
            const match=/^property (float|uchar) (\w+)$/.exec(line);
            if (!match || properties[match[2]]) throw new Error('Unsupported or duplicate PLY vertex property');
            properties[match[2]]=match[1]; stride+=match[1]==='float'?4:1;
        }
    }
    const offset=new TextEncoder().encode(text.slice(0,end.index+end[0].length)).length;
    if (!Number.isSafeInteger(count) || count<1 || count>1000000 || !stride || count*stride>buffer.byteLength-offset) throw new Error('Invalid or truncated PLY vertex data (limit 1 million points)');
    for (const name of ['x','y','z','opacity','rot_0','rot_1','rot_2','rot_3','scale_0','scale_1','scale_2','f_dc_0','f_dc_1','f_dc_2']) {
        if (properties[name]!=='float') throw new Error('Missing float property: '+name);
    }
    return [count,properties,new DataView(buffer,offset,count*stride)];
}

export function readRawVertex(offset: number, data: DataView, properties: Record<string,string>): [number,Record<string,number>] {
    const vertex: Record<string,number>={};
    for (const [name,type] of Object.entries(properties)) {
        const value=type==='float'?data.getFloat32(offset,true):data.getUint8(offset)/255;
        if (!Number.isFinite(value) || Math.abs(value)>65504) throw new Error('Non-finite or unrepresentable PLY value: '+name);
        vertex[name]=value; offset+=type==='float'?4:1;
    }
    return [offset,vertex];
}
export function nShCoeffs(degree: number): number {
    if (!Number.isInteger(degree)||degree<0||degree>3) throw new Error('Unsupported SH degree: '+degree);
    return (degree+1)**2;
}
