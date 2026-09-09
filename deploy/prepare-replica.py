"""Prepare public genesis and configuration for the local replica experiment.
Run from the repository root after starting the primary Compose stack.
No database or validator private keys are copied.
"""
import json
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parent.parent
runtime = root / 'deploy/replica-runtime'
runtime.mkdir(exist_ok=True)
config = json.loads((root / 'services/ledger/config/default/config.json').read_text())
config['genesis']['block']['fromFile'] = '/replica/genesis_block.blob'
config['generator']['keys']['fromFile'] = '/replica/empty-validators.json'
config['network']['seedPeers'] = [{'ip': 'trustseco-next-dlt-1', 'port': 8000}]
(runtime / 'config.json').write_text(json.dumps(config, indent=2) + '\n')
(runtime / 'empty-validators.json').write_text('{"keys":[]}\n')
subprocess.run(['docker', 'cp', 'trustseco-next-dlt-1:/root/.klayr/TrustSECO-dlt/config/genesis_block.blob', str(runtime / 'genesis_block.blob')], check=True)
print('Replica configured with the primary genesis and no validator keys.')
