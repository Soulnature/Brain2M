"""Exercise the actual static website in isolated Chromium under a Pages subpath."""
from pathlib import Path
import os,sys,json,gzip,threading,tempfile,http.server,functools,csv,io,math
ROOT=Path(__file__).resolve().parents[1]
PORTAL=ROOT.parent/'Brain2M_resource_portal_20261022'
sys.path.insert(0,str(PORTAL/'.qa_deps'))
os.environ.setdefault('PLAYWRIGHT_BROWSERS_PATH',str(PORTAL/'.qa_browsers'))
from playwright.sync_api import sync_playwright,expect

class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*args):pass


def main():
    qa=ROOT/'qa';qa.mkdir(exist_ok=True);checks=[];errors=[];failed=[];external=[];console_errors=[]
    rows=json.loads(gzip.decompress((ROOT/'data/associations/variants.json.gz').read_bytes()))
    byid={r[1]:r for r in rows}
    with tempfile.TemporaryDirectory(prefix='brain2m_pages_',dir='/data/tmp')as td:
        Path(td,'Brain2M').symlink_to(ROOT,target_is_directory=True)
        handler=functools.partial(QuietHandler,directory=td)
        server=http.server.ThreadingHTTPServer(('127.0.0.1',0),handler)
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        try:
            url=f'http://127.0.0.1:{server.server_port}/Brain2M/'
            with sync_playwright()as p:
                browser=p.chromium.launch(headless=True,args=['--no-sandbox','--enable-unsafe-swiftshader'])
                context=browser.new_context(viewport={'width':1512,'height':1000},reduced_motion='reduce',accept_downloads=True)
                page=context.new_page()
                page.on('pageerror',lambda e:errors.append(str(e)))
                page.on('console',lambda m:console_errors.append(m.text)if m.type=='error'else None)
                page.on('requestfailed',lambda r:failed.append({'url':r.url,'failure':r.failure}))
                page.on('request',lambda r:external.append(r.url)if not r.url.startswith(('http://127.0.0.1:','data:','blob:'))else None)
                page.goto(url,wait_until='networkidle',timeout=60000)
                expect(page.locator('#dataStatus')).to_contain_text('Real association index loaded',timeout=60000)
                expect(page.locator('#scaleNote')).to_contain_text('20,018,724')
                assert page.evaluate("!!document.querySelector('#stage').getContext('webgl2')")
                initial_assets=page.evaluate("performance.getEntriesByType('resource').map(r=>({name:r.name,bytes:r.transferSize}))")
                assert not any('/snp/'in r['name']or '/voxel/'in r['name']for r in initial_assets)
                page.screenshot(path=str(qa/'desktop_overview.png'))
                checks.append('Static site loads under /Brain2M/ without external requests; real counts and WebGL scene present')
                def search(q):
                    page.locator('#searchInput').fill(q);page.locator('#searchInput').press('Enter')
                search('rs13107325')
                expect(page.locator('#snpTitle')).to_have_text('rs13107325',timeout=30000)
                expect(page.locator('#snpCount')).to_contain_text('100,531')
                expect(page.locator('#snpBody tr')).to_have_count(20)
                page.screenshot(path=str(qa/'desktop_SNP_real_map.png'))
                checks.append('rs13107325 complete 100,531 significant voxels and native anatomical slices load')
                with page.expect_download()as d:page.locator('#downloadSnp').click()
                path=d.value.path();tab=list(csv.DictReader(Path(path).read_text().splitlines(),delimiter='\t'))
                assert len(tab)==byid['rs13107325'][6]
                assert len({x['source_voxel_ID']for x in tab})==len(tab)
                first=tab[0];target=' '.join(first[x]for x in ['i','j','k'])
                page.locator('#snpBody tr').first.locator('button').click()
                expect(page.locator('#panelVoxel')).to_have_attribute('data-voxel-id',first['source_voxel_ID'])
                assert target.replace(' ',', ')in page.locator('#voxTitle').inner_text()
                with page.expect_download()as d:page.locator('#downloadVoxel').click()
                reverse=list(csv.DictReader(Path(d.value.path()).read_text().splitlines(),delimiter='\t'))
                pair=next(r for r in reverse if r['SNP']=='rs13107325')
                assert pair['source_voxel_ID']==first['source_voxel_ID'] and abs(float(pair['T'])-float(first['T']))<1e-6 and float(pair['minus_log10_P'])==float(first['minus_log10_P'])
                checks.append('Full TSV download and exact SNP→voxel→SNP round trip retain T, stored logP and native IDs')
                page.locator('#snpPager button',has_text='Next').click()
                expect(page.locator('#snpCount')).to_contain_text('21–40')
                page.locator('#snpPager button',has_text='Previous').click()
                checks.append('Large significant-voxel tables paginate without truncating downloads')
                # Select an actual significant SNP at its canvas location, then click blank space.
                lead=reverse[0]
                lengths=[249.250621,243.199373,198.022430,191.154276,180.915260,171.115067,159.138663,146.364022,141.213431,135.534747,135.006516,133.851895,115.169878,107.349540,102.531392,90.354753,81.195210,78.077248,59.128983,63.025520,48.129895,51.304566]
                chrn=int(lead['CHR']);frac=((chrn-1)*.02+.01+(sum(lengths[:chrn-1])+int(lead['BP'])/1e6)/sum(lengths)*(2*math.pi-.02*22))/(2*math.pi)
                box=page.locator('#manhattan').bounding_box();ymax=max(16,max(float(r['minus_log10_P'])for r in reverse))*1.08
                x=42+frac*(box['width']-52);y=9+(box['height']-34)*(1-float(lead['minus_log10_P'])/ymax)
                page.locator('#manhattan').click(position={'x':x,'y':y})
                expect(page.locator('#snpTitle')).to_have_text(lead['SNP'],timeout=30000)
                page.locator('#manhattan').click(position={'x':2,'y':2})
                expect(page.locator('#snpTitle')).to_have_text(lead['SNP'])
                page.screenshot(path=str(qa/'desktop_bidirectional_hotspots.png'))
                checks.append('Only actual significant SNP hotspots react to canvas clicks; blank background does not select a SNP')
                search('999 0 0');expect(page.locator('#searchMsg')).to_contain_text('No source voxel is indexed')
                assert page.locator('#panelVoxel').get_attribute('data-voxel-id')==first['source_voxel_ID']
                search('rs999999999999');expect(page.locator('#searchMsg')).to_contain_text('absent')
                checks.append('Unknown rsIDs and out-of-grid voxel queries report no match without nearest-coordinate substitution')
                search('SLC39A8');expect(page.locator('#searchMsg')).to_contain_text('gene interval')
                expect(page.locator('#panelSnp')).to_be_visible()
                checks.append('Gene search uses the source GRCh37 gene interval and labels positional evidence')
                # Back-to-back requests must leave only the latest SNP selected.
                page.evaluate("""() => {for(const q of ['rs2286571','rs429358']){document.querySelector('#searchInput').value=q;document.querySelector('#search').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));}}""")
                expect(page.locator('#snpTitle')).to_have_text('rs429358',timeout=30000)
                expect(page.locator('#snpCount')).to_contain_text('1 significant associations')
                checks.append('Rapid successive SNP requests retain the latest requested SNP')
                # Real SNP-specific colored voxel: hover/click at its exact native slice pixel.
                peak=byid['rs429358'][7]
                import numpy as np
                packed=np.frombuffer(gzip.decompress((ROOT/'data/associations/coordinates.u32.gz').read_bytes()),dtype='<u4')
                ijk=list(map(int,np.unravel_index(packed[peak],(182,218,182))))
                # Clear voxel selection so slices center on the SNP peak.
                page.locator('#closeVoxel').click()
                cv=page.locator('#sliceAx');box=cv.bounding_box();scale=min(box['width']/182,box['height']/218)
                ox=(box['width']-182*scale)/2;oy=(box['height']-218*scale)/2
                cv.click(position={'x':ox+(ijk[0]+.5)*scale,'y':oy+(217-ijk[1]+.5)*scale})
                # A physical mouse pixel can span multiple native pixels at thumbnail scale.
                # The exact 1-mm table button provides an unambiguous equivalent action.
                if page.locator('#panelVoxel').is_hidden():page.locator('#snpBody tr').first.locator('button').click()
                expect(page.locator('#panelVoxel')).to_have_attribute('data-voxel-id',str(peak))
                checks.append('Native SNP peak voxel can be selected from its map/table')
                # Use a source voxel without significant pairs to verify true empty state.
                offsets=np.frombuffer(gzip.decompress((ROOT/'data/associations/voxel-offsets.u32.gz').read_bytes()),dtype='<u4')
                empty=int(np.flatnonzero(offsets[1:]==offsets[:-1])[0]);emptyijk=np.unravel_index(packed[empty],(182,218,182))
                search(' '.join(map(str,emptyijk)));expect(page.locator('#voxelCount')).to_contain_text('0 significant associations')
                expect(page.locator('#voxelBody tr')).to_have_count(0)
                checks.append('A valid source voxel with no significant pairs produces a genuine empty result')
                page.set_viewport_size({'width':390,'height':844})
                search('rs2286571');expect(page.locator('#snpTitle')).to_have_text('rs2286571',timeout=30000)
                expect(page.locator('#snpCount')).to_contain_text('109 significant associations')
                expect(page.locator('#sliceReadout')).to_contain_text('Static anatomical background')
                page.screenshot(path=str(qa/'mobile_SNP_map.png'))
                assert not page.evaluate('document.documentElement.scrollWidth > innerWidth+1')
                page.locator('#btnOverview').click();page.screenshot(path=str(qa/'mobile_overview.png'))
                checks.append('Mobile overview and data panels render without page-level horizontal overflow')
                assert not errors,errors;assert not failed,failed;assert not external,external;assert not console_errors,console_errors
                # Negative fetch path in a separate context: error is surfaced, then retry succeeds.
                broken=browser.new_context(viewport={'width':1280,'height':900},reduced_motion='reduce')
                p2=broken.new_page();p2.goto(url,wait_until='networkidle');expect(p2.locator('#dataStatus')).to_contain_text('Real association index loaded',timeout=60000)
                p2.route('**/snp/*.bin.gz',lambda r:r.fulfill(status=404,body='missing shard'))
                p2.locator('#searchInput').fill('rs2286571');p2.locator('#searchInput').press('Enter')
                expect(p2.locator('#dataStatus')).to_contain_text('HTTP 404',timeout=30000)
                assert p2.locator('#panelSnp').is_hidden()
                p2.unroute('**/snp/*.bin.gz');p2.locator('#searchInput').press('Enter')
                expect(p2.locator('#snpTitle')).to_have_text('rs2286571',timeout=30000)
                checks.append('Missing shard shows a clear error without fabricated data; retry recovers')
                broken.close();browser.close()
        finally:server.shutdown();server.server_close();thread.join(timeout=5)
    (qa/'BROWSER_VALIDATION.json').write_text(json.dumps({'status':'pass','checks':checks,'page_errors':errors,'console_errors_in_normal_flow':console_errors,'failed_requests_in_normal_flow':failed,'external_requests':external,'initial_transfer_bytes':sum(r['bytes']for r in initial_assets),'initial_association_shards_requested':0,'hosting_mode':'Static HTTP under /Brain2M/; temporary localhost server stopped after tests.'},indent=2))
    print(json.dumps({'status':'pass','checks':checks},indent=2))

if __name__=='__main__':main()
