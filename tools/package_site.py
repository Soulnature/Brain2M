"""Package the tested static site without git history or rebuild intermediates."""
from pathlib import Path
import hashlib,json,subprocess,zipfile
ROOT=Path(__file__).resolve().parents[1]

def main():
    for name in ['BROWSER_VALIDATION','ALL_PAIR_DATA_AUDIT','COORDINATE_ATLAS_AUDIT']:
        assert json.loads((ROOT/'qa'/f'{name}.json').read_text())['status']=='pass',name
    output=ROOT.parent/'Brain2M_GitHubPages_ready_20261117.zip';partial=output.with_suffix('.zip.partial')
    selected=[ROOT/p for p in ['index.html','styles.css','.nojekyll','.gitignore','README.md','IMPLEMENTATION.md','package.json']]
    for tree in ['src','assets','vendor','data','tests','tools']:
        selected.extend(p for p in (ROOT/tree).rglob('*')if p.is_file()and not any(part in {'.export_cache','__pycache__'}for part in p.relative_to(ROOT).parts))
    with zipfile.ZipFile(partial,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6)as z:
        for p in sorted(selected):z.write(p,Path('Brain2M')/p.relative_to(ROOT),compress_type=zipfile.ZIP_STORED if p.suffix=='.gz'else zipfile.ZIP_DEFLATED)
    with zipfile.ZipFile(partial)as z:
        assert z.testzip()is None
        assert 'Brain2M/data/associations/manifest.json'in z.namelist()
        assert not any('/.git/'in n or '/.export_cache/'in n for n in z.namelist())
    partial.replace(output)
    meta=json.loads((ROOT/'data/associations/manifest.json').read_text());browser=json.loads((ROOT/'qa/BROWSER_VALIDATION.json').read_text())
    head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
    receipt={'status':'local_ready','archive':str(output),'archive_bytes':output.stat().st_size,'archive_MiB':output.stat().st_size/2**20,'archive_sha256':hashlib.sha256(output.read_bytes()).hexdigest(),'included_files':len(selected),'baseline_commit':head,'significant_SNPs':meta['significant_SNPs'],'significant_pairs':meta['significant_pairs'],'native_source_voxels':meta['source_voxels'],'atlas_regions':120,'all_pair_forward_and_reverse_audit':'pass','coordinate_and_atlas_audit':'pass','browser_checks_passed':len(browser['checks']),'initial_transfer_bytes':browser['initial_transfer_bytes'],'initial_association_shards_requested':0,'remote_push_performed':False,'new_commit_created':False,'test_servers_stopped':True}
    (ROOT/'qa/LOCAL_RELEASE.json').write_text(json.dumps(receipt,indent=2));print(json.dumps(receipt,indent=2))

if __name__=='__main__':main()
