import sys
from pathlib import Path


backend_root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(backend_root))

