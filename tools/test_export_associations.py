import unittest
import numpy as np
from export_associations import encode_records, packed_coordinates, RECORD_DTYPE

class AssociationExportTests(unittest.TestCase):
    def test_binary_preserves_id_sign_and_stored_logp(self):
        raw=encode_records(np.array([0,2075297]),np.array([-9.25,12.5]),np.array([13.6181104633,450.123456789]))
        out=np.frombuffer(raw,dtype=RECORD_DTYPE)
        self.assertEqual(out['other'].tolist(),[0,2075297])
        np.testing.assert_array_equal(out['t'],[-9.25,12.5])
        np.testing.assert_array_equal(out['lp'],[13.6181104633,450.123456789])
        self.assertEqual(len(raw),32)

    def test_native_coordinate_roundtrip_keeps_order(self):
        shape=(182,218,182)
        xyz=np.array([[181,217,181],[0,0,0],[77,122,99]],dtype=int)
        packed=packed_coordinates(xyz,shape)
        recovered=np.stack(np.unravel_index(packed,shape),axis=1)
        np.testing.assert_array_equal(recovered,xyz)

    def test_negative_and_out_of_grid_coordinates_rejected(self):
        with self.assertRaises(ValueError):packed_coordinates(np.array([[-1,0,0]]),(182,218,182))
        with self.assertRaises(ValueError):packed_coordinates(np.array([[182,0,0]]),(182,218,182))

    def test_bad_record_lengths_rejected(self):
        with self.assertRaises(ValueError):encode_records([1,2],[3],[14,15])

if __name__=='__main__':unittest.main()
