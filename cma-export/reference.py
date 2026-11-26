"""Source-preserving PDF rendering: change bound content, never recreate slide layouts."""
from __future__ import annotations
import hashlib
import math
import re
from pathlib import Path
import pymupdf as pdf

SOURCE=Path(__file__).parent/'sources'/'new.pdf'


def blocks(page):
    return page.get_text('dict')['blocks']


def text(block):
    return '\n'.join(''.join(s['text'] for s in line['spans']) for line in block['lines'])


def bindings(doc):
    result=[]
    def bind(page,field,indices,line=None,rect=None,align='left',transform=None):
        bs=blocks(doc[page-1]); indices=indices if isinstance(indices,list) else [indices]
        lines=[l for index in indices for l in bs[index]['lines']]
        if line is not None: lines=[lines[line]]
        spans=[s for l in lines for s in l['spans']]
        bounds=pdf.Rect(lines[0]['bbox'])
        for l in lines[1:]:bounds|=pdf.Rect(l['bbox'])
        original='\n'.join(''.join(s['text'] for s in l['spans']) for l in lines)
        style=spans[0]
        result.append(dict(page=page,field=field,original=original,erase=[l['bbox'] for l in lines],rect=list(rect or bounds),font=style['font'],size=style['size'],color=style['color'],align=align,transform=transform))
    bind(8,'agent_eyebrow',0,rect=[64.8,69.9,577,87])
    bind(1,'cover_caption',4,rect=[64.8,443.45,895.2,462])
    for field,index,rect in [('property_headline',1,[64.8,100.1,895.2,135]),('property_subtitle',2,[64.8,142.6,895.2,166]),('property_tax_record',[5,6,7],[74.8,402.7,228,451]),('property_listing_history',[9,10,11],[248,402.7,392,451]),('property_layout',[23,24,25,26,27],[430,256.7,649,346]),('property_garage_lot',[29,30,31,32,33],[672,256.7,895.2,346]),('property_kitchen_finishes',[35,36,37,38],[430,378.7,649,470]),('property_updates_systems',[40,41,42,43],[672,378.7,895.2,470]),('property_source_note',44,[64.8,493,895.2,507])]:
        bind(3,field,index,rect=rect)
    for field,index,x in [('property_beds',12,420),('property_full_baths',14,515),('property_sqft',16,610),('property_acres',18,705),('property_year_built',20,800)]:bind(3,field,index,rect=[x,180.1,x+95,205],align='center')
    bind(3,'property_baths_label',15,rect=[515,207,610,224],align='center')
    for page in [4,5]:
        for col in range(4):
            start=4+col*12; x=75.6+col*211.18; right=x+175.2
            number=(page-4)*3+col
            bind(page,'subject_address' if col==0 else f'comp_{number}_address',start,rect=[x,284.6,right,300.5])
            bind(page,'subject_location' if col==0 else f'comp_{number}_location',start+1,line=0,rect=[x,300.9,right,314.8])
            bind(page,'subject_price' if col==0 else f'comp_{number}_price',start+1,line=1,rect=[x,315.8,right,334])
            keys=['closed_date','beds','baths','sqft','price_per_sqft','lot','year_built','garage']
            subject=[None,'property_beds','subject_baths','property_sqft',None,'subject_lot','property_year_built','subject_garage']
            for row,key in enumerate(keys):
                if col==0 and subject[row] is None:continue
                bind(page,subject[row] if col==0 else f'comp_{number}_{key}',start+2+row,line=1,rect=[x+74,342.2+16.6*row,right,355+16.6*row],align='right')
        bind(page,'comparables_source_note' if page==4 else 'comparables_summary_note',50,rect=[64.8,490.3,895.2,505],align='center')
    for field,index,rect in [('agent_name',1,[64.8,110.9,577,145]),('agent_role',2,[64.8,157.9,577,178]),('agent_bio',[3,4,5],[64.8,198.5,577,345])]:bind(8,field,index,rect=rect)
    for field,index,x in [('agent_experience',6,78.8),('agent_licenses',8,253.8),('agent_client_types',10,428.8)]:bind(8,field,index,rect=[x,361.2,x+150,382])
    for field,index,x,w in [('agent_phone',12,82,115),('agent_email',13,208,189),('agent_license_number',14,408,90),('agent_mls_id',15,514,62)]:bind(8,field,index,line=1,rect=[x,444,x+w,459])
    bind(9,'team_verified_award',8,rect=[64.8,475.87,540,492])
    for field,index,x,y,w in [('property_caption',3,83.2,218.8,365),('features',5,83.2,293.7,365),('buyer_profiles',7,83.2,368.6,365),('positioning',9,83.2,443.4,365),('improvements',11,506.6,218.8,365),('strengths',13,506.6,293.7,365),('objections_caption',15,506.6,368.6,365),('seller_goals',17,506.6,443.4,365)]:
        # The original placeholder occupies less than the card's available body area.
        # Keep two points below the heading and three above the bottom border.
        bind(10,field,index,rect=[x,y-4.5,x+w,y+25])
        result[-1].update(minimum_size=6.25,line_spacing=1.1)
    for field,index,x in [('market_active',2,64.8),('market_pending',4,277),('market_dom',6,489),('market_months_supply',8,701)]:bind(14,field,index,rect=[x,205.4,x+194,279],align='center')
    bind(14,'market_summary',10,rect=[64.8,364.5,895.2,390],align='center')
    bind(14,'market_source_caption',11,rect=[79.2,417.3,880.8,440],align='center')
    bind(31,'brokerage_active_edition',9,rect=[586.8,218,881,240])
    bind(31,'brokerage_reach',10,rect=[604.8,249.49,881,290])
    bind(31,'brokerage_verified_partners',11,rect=[604.8,299.89,881,335])
    bind(38,'proof_property_address',5,rect=[290.4,285.8,464.4,305])
    bind(38,'proof_property_price',6,rect=[290.4,309.6,464.4,335])
    bind(38,'proof_financial_caption',7,rect=[290.4,340.5,464.4,384])
    bind(38,'proof_source_note',19,rect=[79.2,434.5,880.8,452],align='center')
    for i in range(1,4):
        x=84.3+(i-1)*282.55
        bind(39,f'testimonial_{i}_quote',2+i*2,rect=[x,272.1,x+227,377])
        bind(39,f'testimonial_{i}_attribution',3+i*2,rect=[x,390,x+227,411])
    return result


def image_bindings(doc):
    targets={1:[('logo_image',3)],3:[('property_image',3)],4:[('subject_image',2),('comp_1_image',14),('comp_2_image',26),('comp_3_image',38)],5:[('subject_image',2),('comp_4_image',14),('comp_5_image',26),('comp_6_image',38)],8:[('agent_portrait',16)],9:[('team_portrait',6)],12:[('listing_screen_image',[7,8,9])],21:[('before_image',8),('after_image',9)],22:[('media_gallery',[8,9,10])],38:[('proof_images',[15,16,17,18])],43:[('logo_image',5)]}
    result=[]
    for page,entries in targets.items():
        bs=blocks(doc[page-1])
        for key,indices in entries:
            indices=indices if isinstance(indices,list) else [indices]
            images=[bs[i] for i in indices]
            if not all(b['type']==1 for b in images):raise ValueError(f'Unexpected source image blocks on page {page}')
            result.append(dict(page=page,field=key,images=images))
    return result


def derived(data):
    d=dict(data)
    v=lambda k:str(data[k]) if data.get(k) not in (None,'') else '—'
    d['agent_eyebrow']='M E E T  '+' '.join(v('agent_name').split()[0].upper()) if v('agent_name')!='—' else 'M E E T  Y O U R  A G E N T'
    d['cover_caption']=data.get('cover_caption') or f"Prepared for {v('seller_name')}  ·  {v('property_address')}  ·  {v('presentation_date')}"
    d['subject_address']=v('property_address').split(',')[0]
    d['subject_location']=v('property_subtitle').split(' · ')[0].split('  ·  ')[0]
    d['property_caption']=f"{v('property_address')} · {v('property_type')}"
    d['objections_caption']=v('objections')+' — things we plan for' if v('objections')!='—' else '—'
    d['market_summary']=f"Recent solds {v('market_recent_solds')}   ·   Price reductions {v('market_price_reductions')}   ·   Market direction {v('market_trend')}"
    d['market_source_caption']=data.get('market_source_caption') or f"SOURCE: {v('market_source')} · {v('market_scope')} · AS OF {v('market_as_of')} — never estimated; pulled live per property"
    d['proof_financial_caption']=v('proof_property_summary')+'\n'+v('proof_property_financials')
    d['comparables_summary_note']=data.get('comparables_summary_note') or v('comparables_source_note')
    d['agent_name']=v('agent_name').upper().rstrip('.')+'.' if v('agent_name')!='—' else '—'
    return d


def normalize(text):return ' '.join(str(text).split())


def get_font(doc,page,name):
    full_font=Path(__file__).parent/'fonts'/(name+'.ttf')
    if full_font.is_file():
        buffer=full_font.read_bytes()
        return pdf.Font(fontbuffer=buffer),buffer
    for xref,ext,kind,base,resource,*rest in page.get_fonts(full=True):
        if base.split('+')[-1].replace('-','')==name.replace('-',''):
            buffer=doc.extract_font(xref)[3] if xref else None
            if buffer:return pdf.Font(fontbuffer=buffer),buffer
            builtin={'Helvetica':'helv','Helvetica-Bold':'hebo','Times-Roman':'tiro','Times-Bold':'tibo'}.get(base,'helv')
            return pdf.Font(builtin),None
    return pdf.Font('helv'),None


def wrap(text,font,size,width):
    lines=[]
    for paragraph in str(text).split('\n'):
        line=''
        for word in paragraph.split():
            trial=(line+' '+word).strip()
            if font.text_length(trial,fontsize=size)<=width:line=trial
            else:
                if line:lines.append(line);line=''
                # Break oversized single words instead of allowing horizontal overflow.
                for char in word:
                    if line and font.text_length(line+char,fontsize=size)>width:lines.append(line);line=''
                    line+=char
        lines.append(line)
    return lines


def layout(binding,new,font):
    """Return as many box-sized pieces as necessary, without discarding content."""
    rect=pdf.Rect(binding['rect']);size=float(binding['size'])
    minimum=min(size,binding.get("minimum_size",7.0))
    metrics=font.ascender-font.descender
    while True:
        lines=wrap(new,font,size,rect.width)
        leading=binding.get("line_spacing",max(1.18,metrics))*size
        height=metrics*size+max(0,len(lines)-1)*leading
        if height<=rect.height+0.1:return [(rect,size,lines,leading)]
        if size<=minimum:
            # Each extra piece uses a copy of the source slide, keeping its design.
            capacity=max(1,math.floor((rect.height-metrics*size+0.1)/leading)+1)
            return [(rect,size,lines[i:i+capacity],leading) for i in range(0,len(lines),capacity)]
        size=max(minimum,size-0.25)


def render_pdf(data,destination,base=Path('.'),draft=False,source=SOURCE,pages=None,clear_missing_images=False):
    destination=Path(destination);destination.parent.mkdir(parents=True,exist_ok=True)
    doc=pdf.open(source)
    if len(doc)!=43:raise ValueError('Expected the supplied 43-page PDF source.')
    if 'HOW YOUR HOME COMPARES.' not in doc[3].get_text() or 'TARIK HAGE.' not in doc[7].get_text():
        raise ValueError('The field map requires the supplied new.pdf source layout.')
    selected_pages = pages or range(1, len(doc) + 1)
    values=derived(data); records=[]
    source_images=image_bindings(doc)
    for b in bindings(doc):
        if b['page'] not in selected_pages:continue
        new=values.get(b['field'])
        new='—' if new is None or not str(new).strip() else str(new)
        # Preserve original operators, exact font shaping and spacing when unchanged.
        if normalize(new)==normalize(b['original']):continue
        font,buffer=get_font(doc,doc[b['page']-1],b['font'])
        if any(not font.has_glyph(ord(c)) for c in new if not c.isspace()):
            new = "".join(c if c.isspace() or font.has_glyph(ord(c)) else "?" for c in new)
        records.append((b,new,font,buffer,layout(b,new,font)))
    # Insert continuation pages immediately after their source slide.
    source_doc=doc;doc=pdf.open();page_map={};planned=[];continuations=[]
    for original_page in selected_pages:
        entries=[entry for entry in records if entry[0]['page']==original_page]
        count=max([len(entry[4]) for entry in entries] or [1])
        page_map[original_page]=[]
        for part in range(count):
            doc.insert_pdf(source_doc,from_page=original_page-1,to_page=original_page-1,links=pages is None,annots=pages is None,widgets=pages is None)
            page_number=len(doc);page_map[original_page].append(page_number)
            if part:continuations.append((page_number,part+1,count))
            for binding,new,font,buffer,pieces in entries:
                if len(pieces)==1:piece=pieces[0]
                elif part<len(pieces):piece=pieces[part]
                else:piece=layout(binding,'—',font)[0]
                planned.append(({**binding,'page':page_number},new,font,buffer,piece))
    source_images=[{**target,'page':number} for target in source_images for number in page_map.get(target['page'], [])]
    source_doc.close()
    for page_number in sorted({b['page'] for b,*_ in planned}):
        page=doc[page_number-1]
        entries=[entry for entry in planned if entry[0]['page']==page_number]
        for b,*_ in entries:
            for coords in b['erase']:page.add_redact_annot(pdf.Rect(coords),fill=False,cross_out=False)
        page.apply_redactions(images=0,graphics=0)
        for index,(b,new,font,buffer,(rect,size,lines,leading)) in enumerate(entries):
            name=f'Variable{index}' if buffer else font.name
            if buffer:page.insert_font(fontname=name,fontbuffer=buffer)
            else:name={'Helvetica':'helv','Helvetica-Bold':'hebo','Times-Roman':'tiro','Times-Bold':'tibo'}.get(font.name,'helv')
            c=b['color'];color=((c>>16&255)/255,(c>>8&255)/255,(c&255)/255)
            for line_index,line in enumerate(lines):
                width=font.text_length(line,fontsize=size)
                x=rect.x1-width if b['align']=='right' else rect.x0+(rect.width-width)/2 if b['align']=='center' else rect.x0
                page.insert_text((x,rect.y0+font.ascender*size+line_index*leading),line,fontsize=size,fontname=name,color=color)
    for target in source_images:
        field=target['field']; paths=data.get(field)
        if not paths:
            if clear_missing_images and field != 'logo_image':
                page = doc[target['page'] - 1]
                for image in target['images']:
                    page.add_redact_annot(pdf.Rect(image['bbox']), fill=False, cross_out=False)
                page.apply_redactions(images=1, graphics=0, text=1)
            continue
        paths=paths if isinstance(paths,list) else [paths]
        originals=target['images'];page=doc[target['page']-1]
        # Retain source images byte-for-byte when example assets have not changed.
        if field=='listing_screen_image' and len(paths)==1:
            source_asset=Path(__file__).parent/'example-assets'/'listing-screen.png'
            if source_asset.is_file() and (base/str(paths[0])).read_bytes()==source_asset.read_bytes():continue
        if len(paths)==len(originals) and all(hashlib.sha256((base/str(path)).read_bytes()).digest()==hashlib.sha256(b['image']).digest() for path,b in zip(paths,originals)):continue
        rects=[pdf.Rect(b['bbox']) for b in originals]
        for rect in rects:page.add_redact_annot(rect,fill=False,cross_out=False)
        page.apply_redactions(images=1,graphics=0,text=1)
        if len(paths)==len(rects): placements=rects
        else:
            bounds=pdf.Rect(rects[0])
            for rect in rects[1:]:bounds|=rect
            cols=math.ceil(math.sqrt(len(paths)));rows=math.ceil(len(paths)/cols)
            placements=[pdf.Rect(bounds.x0+i%cols*bounds.width/cols,bounds.y0+i//cols*bounds.height/rows,bounds.x0+(i%cols+1)*bounds.width/cols,bounds.y0+(i//cols+1)*bounds.height/rows) for i in range(len(paths))]
        for path,rect in zip(paths,placements):
            if field in {'logo_image','listing_screen_image'}:
                page.insert_image(rect,filename=str(base/str(path)),keep_proportion=True)
            else:
                from PIL import Image,ImageOps
                import io
                with Image.open(base/str(path)) as image:
                    # Fill the source photo box with a centered crop, keeping its exact bounds.
                    image=ImageOps.exif_transpose(image).convert('RGB')
                    width=max(1,image.width);height=max(1,round(width*rect.height/rect.width))
                    cropped=ImageOps.fit(image,(width,height))
                    stream=io.BytesIO();cropped.save(stream,format='PNG')
                page.insert_image(rect,stream=stream.getvalue())
    if pages is not None or len(doc)>43:
        for number,page in enumerate(doc,1):
            footer=[]
            for block in blocks(page):
                for line in block.get('lines',[]):
                    for span in line['spans']:
                        if re.fullmatch(r'\s*\d+\s*/\s*43\s*',span['text']):
                            footer.append(span)
            for span in footer:page.add_redact_annot(pdf.Rect(span['bbox']),fill=False,cross_out=False)
            if footer:page.apply_redactions(images=0,graphics=0)
            if pages is None:page.insert_text((864.5,523),f'{number:02d} / {len(doc)}',fontname='helv',fontsize=7,color=(0.35,0.35,0.35))
        for number,part,count in continuations:
            doc[number-1].insert_text((64.8,32),f'CONTINUED · {part} OF {count}',fontname='helv',fontsize=8,color=(0.35,0.35,0.35))
    doc.save(destination,garbage=4,deflate=True);doc.close()
    return destination


def preview_pptx(pdf_path,output):
    """A presentation preview of the exact PDF pages; content remains editable in source deck."""
    from pptx import Presentation
    from pptx.util import Inches
    import io
    doc=pdf.open(pdf_path);prs=Presentation();prs.slide_width=Inches(13.3333333333);prs.slide_height=Inches(7.5)
    for page in doc:
        slide=prs.slides.add_slide(prs.slide_layouts[6])
        scale = min(prs.slide_width / page.rect.width, prs.slide_height / page.rect.height)
        width, height = int(page.rect.width * scale), int(page.rect.height * scale)
        slide.shapes.add_picture(io.BytesIO(page.get_pixmap(matrix=pdf.Matrix(1.5,1.5)).tobytes('png')),
                                 (prs.slide_width - width) // 2, (prs.slide_height - height) // 2,
                                 width=width, height=height)
    prs.save(output);doc.close();return Path(output)
